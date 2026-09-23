"""RefundShield — threshold-evasion engine (Phase 3).

Detects whether a seller's population contains an unusual concentration of
account return rates immediately BELOW the seller's decision threshold.

WHAT THIS IS NOT
----------------
It is not "rate near 20% therefore suspicious". Proximity to the threshold, on
its own, is almost worthless: in a normal population plenty of honest customers
sit at 19%. What matters is whether there are MORE accounts parked just under
the line than the shape of the surrounding distribution can account for.

WHY A FLAT NEIGHBOURHOOD AVERAGE DOES NOT WORK
----------------------------------------------
Return-rate distributions decline steeply through this region. On our own
synthetic seller the bins from 12% to 18% average 3.5 accounts each, so a flat
average predicts 7.0 accounts in the 18-20% window. The coordinated scenario
actually contains 6 — FEWER than the flat baseline predicts — so a flat
baseline reports no bunching at all in the very scenario it is meant to catch.

The baseline therefore has to respect the decline. We fit a straight line
through the reference bins approaching the window from below and extrapolate it
across the window. On the same data that predicts 1.29 accounts, against which
the normal scenario's 1 is unremarkable and the coordinated scenario's 6 is not.

    reference bins 12-18%      ->  fitted trend  ->  expected in [18%, 20%)
    normal      observed 1                          1.29   excess -0.29
    coordinated observed 6                          1.29   excess +4.71

METHOD (deliberately simple and inspectable)
--------------------------------------------
    1. keep only accounts whose return rate is reliable (enough orders)
    2. bin those rates into fixed-width bins, in integer basis points
    3. window   W = [threshold - window_width, threshold)      (half-open)
    4. reference R = the bins immediately below W, excluding W and a guard band
    5. least-squares line through R, extrapolated across W  -> expected count
    6. excess = observed - expected
    7. score  = excess magnitude GATED BY Poisson significance

Step 7's Poisson term is what stops a tiny population from manufacturing a big
signal: 2 observed against 0.5 expected is a ratio of 3.0 but is not surprising,
and multiplying by significance prices that in.

This produces a POPULATION-LEVEL PATTERN, never a verdict about a person.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ..config import SCORING_NOTICE, SETTINGS, band_for
from .features import AccountFeatures

# --------------------------------------------------------------------------
# Tunables (all overridable per call)
# --------------------------------------------------------------------------
DEFAULT_BIN_WIDTH = 0.01          # 1 percentage point
DEFAULT_WINDOW_WIDTH = 0.02       # look at [threshold-2pp, threshold)
DEFAULT_REFERENCE_SPAN = 0.06     # 6 bins of trend below the window
DEFAULT_GUARD_ABOVE = 0.01        # ignore the bin just above the threshold
DOMAIN_MAX = 0.60                 # rates above this are treated as outliers

MIN_ELIGIBLE_ACCOUNTS = 25        # below this the population is too thin to judge
MIN_REFERENCE_BINS = 4            # need this many bins to fit a trend
MIN_REFERENCE_MASS = 5            # ...and enough accounts in them for the trend to mean anything
MIN_EXPECTED_PER_BIN = 0.05       # floor so a negative extrapolation can't divide by zero
MIN_EXPECTED_TOTAL = 0.50         # floor on the whole window, so a degenerate fit
                                  # cannot turn 2 accounts into an enormous ratio

RATIO_FULL_AT = 3.0               # excess/expected at which the magnitude term saturates
SIGNIFICANCE_FULL_AT = 3.0        # -log10(p) at which significance saturates (p = 0.001)

# per-account signal (Phase 4 hook)
IN_WINDOW_BASE_CREDIT = 0.50      # every in-window account gets at least half credit
GATE_FLOOR = 0.35                 # proximity with NO population bunching caps here

INSUFFICIENT = "Insufficient population data"


def _poisson_sf(k: int, lam: float) -> float:
    """P(X >= k) for X ~ Poisson(lam). Summed directly; counts here are small."""
    if k <= 0:
        return 1.0
    if lam <= 0:
        return 0.0
    term = math.exp(-lam)
    cdf = term
    for i in range(1, k):
        term *= lam / i
        cdf += term
    return max(0.0, min(1.0, 1.0 - cdf))


@dataclass
class Bin:
    lower: float
    upper: float
    count: int
    role: str          # "window" | "reference" | "guard" | "other"
    expected: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "lower": round(self.lower, 4),
            "upper": round(self.upper, 4),
            "lower_pct": round(self.lower * 100, 1),
            "upper_pct": round(self.upper * 100, 1),
            "label": f"{self.lower * 100:.0f}-{self.upper * 100:.0f}%",
            "count": self.count,
            "role": self.role,
            "expected": None if self.expected is None else round(self.expected, 2),
        }


@dataclass
class AccountThresholdSignal:
    """Per-account view of the population pattern — the Phase 4 hook.

    Note the gate: without population-level bunching, an account's proximity to
    the threshold can never push this above GATE_FLOOR of the scale. Sitting at
    19% in an ordinary population is not, by itself, evidence of anything.
    """
    account_id: str
    return_rate: float
    in_window: bool
    proximity: float          # 0 at the window's lower edge, 1 approaching the threshold
    signal: float             # 0-100
    band: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "account_id": self.account_id,
            "return_rate": round(self.return_rate, 4),
            "return_rate_pct": round(self.return_rate * 100, 1),
            "in_window": self.in_window,
            "proximity": round(self.proximity, 3),
            "signal": round(self.signal, 1),
            "band": self.band,
        }


@dataclass
class ThresholdEvasionResult:
    threshold: float
    window: tuple[float, float]
    bin_width: float
    eligible_accounts: int
    excluded_unreliable: int
    observed_count: int
    expected_count: float
    excess_count: float
    excess_ratio: float
    p_value: float
    bunching_score: float
    signal_band: str
    reliable: bool                    # False => not enough data to judge
    reason: str                       # populated when reliable is False
    explanation: str
    caveat: str
    bins: list[Bin] = field(default_factory=list)
    account_signals: dict[str, AccountThresholdSignal] = field(default_factory=dict)
    baseline_method: str = "local linear trend fit over reference bins below the window"
    notice: str = SCORING_NOTICE

    def to_dict(self) -> dict[str, Any]:
        return {
            "threshold": round(self.threshold, 4),
            "threshold_pct": round(self.threshold * 100, 1),
            "window": [round(self.window[0], 4), round(self.window[1], 4)],
            "window_pct": [round(self.window[0] * 100, 1), round(self.window[1] * 100, 1)],
            "bin_width": self.bin_width,
            "eligible_accounts": self.eligible_accounts,
            "excluded_unreliable": self.excluded_unreliable,
            "observed_count": self.observed_count,
            "expected_count": round(self.expected_count, 2),
            "excess_count": round(self.excess_count, 2),
            "excess_ratio": round(self.excess_ratio, 3),
            "p_value": round(self.p_value, 6),
            "bunching_score": round(self.bunching_score, 1),
            "signal_band": self.signal_band,
            "reliable": self.reliable,
            "reason": self.reason,
            "explanation": self.explanation,
            "caveat": self.caveat,
            "baseline_method": self.baseline_method,
            "bins": [b.to_dict() for b in self.bins],
            "account_signals": {k: v.to_dict() for k, v in self.account_signals.items()},
            "notice": self.notice,
        }


def _bp(x: float) -> int:
    """Rates are handled in integer basis points so bin edges never drift."""
    return int(round(x * 10000))


def analyse(
    features: dict[str, AccountFeatures],
    threshold: float | None = None,
    *,
    window_width: float = DEFAULT_WINDOW_WIDTH,
    bin_width: float = DEFAULT_BIN_WIDTH,
    reference_span: float = DEFAULT_REFERENCE_SPAN,
    guard_above: float = DEFAULT_GUARD_ABOVE,
    min_eligible: int = MIN_ELIGIBLE_ACCOUNTS,
) -> ThresholdEvasionResult:
    """Run the population-level bunching analysis. The threshold is configurable."""
    theta = SETTINGS.threshold if threshold is None else float(threshold)

    caveat = ("Threshold-evasion analysis identifies a population-level pattern. "
              "It does not determine that any individual customer is fraudulent.")

    # ---- 1. eligibility ---------------------------------------------------
    eligible = {
        aid: f for aid, f in features.items()
        if f.rate_is_reliable and 0.0 <= f.return_rate <= DOMAIN_MAX
    }
    excluded = len(features) - len(eligible)

    bw_bp, theta_bp = _bp(bin_width), _bp(theta)
    win_lo_bp = theta_bp - _bp(window_width)
    n_bins = max(1, _bp(DOMAIN_MAX) // bw_bp)

    def empty(reason: str) -> ThresholdEvasionResult:
        return ThresholdEvasionResult(
            threshold=theta, window=(win_lo_bp / 10000, theta),
            bin_width=bin_width, eligible_accounts=len(eligible),
            excluded_unreliable=excluded, observed_count=0, expected_count=0.0,
            excess_count=0.0, excess_ratio=0.0, p_value=1.0, bunching_score=0.0,
            signal_band="LOW", reliable=False, reason=reason,
            explanation=f"{INSUFFICIENT}: {reason}", caveat=caveat,
        )

    if len(eligible) < min_eligible:
        return empty(
            f"only {len(eligible)} accounts have enough orders for a reliable "
            f"return rate (minimum {min_eligible})."
        )

    # ---- 2. bin the reliable rates ---------------------------------------
    counts = [0] * n_bins
    for f in eligible.values():
        idx = min(n_bins - 1, _bp(f.return_rate) // bw_bp)
        counts[idx] += 1

    window_idx = [i for i in range(n_bins)
                  if win_lo_bp <= i * bw_bp < theta_bp]
    ref_lo_bp = win_lo_bp - _bp(reference_span)
    reference_idx = [i for i in range(n_bins)
                     if ref_lo_bp <= i * bw_bp < win_lo_bp]
    guard_idx = [i for i in range(n_bins)
                 if theta_bp <= i * bw_bp < theta_bp + _bp(guard_above)]

    if not window_idx:
        return empty("the configured window contains no bins.")
    if len(reference_idx) < MIN_REFERENCE_BINS:
        return empty(
            f"only {len(reference_idx)} reference bins available below the window "
            f"(minimum {MIN_REFERENCE_BINS}); the threshold may be too close to 0%."
        )

    reference_mass = sum(counts[i] for i in reference_idx)
    if reference_mass < MIN_REFERENCE_MASS:
        return empty(
            f"only {reference_mass} accounts fall in the reference region below the "
            f"window (minimum {MIN_REFERENCE_MASS}); there is no local trend to "
            f"extrapolate, so no baseline can be estimated."
        )

    observed = sum(counts[i] for i in window_idx)

    # ---- 3. local trend baseline -----------------------------------------
    # A straight line through the reference bins, extrapolated across the
    # window. This respects the decline of the distribution; a flat average
    # does not, and on this data a flat average reports no bunching at all.
    xs = np.array(reference_idx, dtype=float)
    ys = np.array([counts[i] for i in reference_idx], dtype=float)
    slope, intercept = np.polyfit(xs, ys, 1)
    per_bin_expected = {
        i: max(MIN_EXPECTED_PER_BIN, float(slope * i + intercept)) for i in window_idx
    }
    expected = max(MIN_EXPECTED_TOTAL, float(sum(per_bin_expected.values())))

    excess = observed - expected
    excess_ratio = excess / max(expected, MIN_EXPECTED_PER_BIN)
    p_value = _poisson_sf(observed, expected)

    # ---- 4. score ---------------------------------------------------------
    if excess <= 0:
        score = 0.0
    else:
        # Significance GATES magnitude rather than being averaged with it. An
        # earlier version added the two, which let a large ratio over a tiny
        # baseline outscore a real excess: 2 accounts against 0.63 expected
        # (ratio 2.2, p = 0.13 — not surprising at all) scored 52.5, while
        # 6 against 2.38 (p = 0.035) scored 45.0. Multiplying fixes that, and
        # is the honest reading: an excess that is not statistically surprising
        # should not score, however large the ratio looks.
        magnitude = min(1.0, excess_ratio / RATIO_FULL_AT)
        significance = min(1.0, (-math.log10(max(p_value, 1e-12))) / SIGNIFICANCE_FULL_AT)
        score = 100.0 * magnitude * significance
    score = max(0.0, min(100.0, score))
    band = band_for(score)

    # ---- 5. bins for the UI ----------------------------------------------
    bins: list[Bin] = []
    for i in range(n_bins):
        lo = i * bw_bp / 10000
        if lo > max(theta + 0.12, 0.32):
            break
        role = ("window" if i in window_idx else
                "reference" if i in reference_idx else
                "guard" if i in guard_idx else "other")
        bins.append(Bin(lower=lo, upper=lo + bin_width, count=counts[i],
                        role=role, expected=per_bin_expected.get(i)))

    # ---- 6. per-account signals (Phase 4 hook) ---------------------------
    gate = GATE_FLOOR + (1.0 - GATE_FLOOR) * (score / 100.0)
    signals: dict[str, AccountThresholdSignal] = {}
    for aid, f in features.items():
        in_win = (f.rate_is_reliable
                  and win_lo_bp <= _bp(f.return_rate) < theta_bp)
        if in_win:
            prox = (f.return_rate - win_lo_bp / 10000) / max(window_width, 1e-9)
            prox = max(0.0, min(1.0, prox))
            credit = IN_WINDOW_BASE_CREDIT + (1.0 - IN_WINDOW_BASE_CREDIT) * prox
            sig = 100.0 * credit * gate
        else:
            prox, sig = 0.0, 0.0
        signals[aid] = AccountThresholdSignal(
            account_id=aid, return_rate=f.return_rate, in_window=in_win,
            proximity=prox, signal=sig, band=band_for(sig),
        )

    # ---- 7. explanation ---------------------------------------------------
    lo_pct, hi_pct = win_lo_bp / 100, theta * 100
    if excess <= 0:
        explanation = (
            f"{observed} reliable accounts sit between {lo_pct:.0f}% and {hi_pct:.0f}%, "
            f"against {expected:.1f} expected from the surrounding distribution. "
            f"No excess concentration below the threshold."
        )
    else:
        explanation = (
            f"{observed} reliable accounts are concentrated between {lo_pct:.0f}% and "
            f"{hi_pct:.0f}%, immediately below the seller's {hi_pct:.0f}% threshold, "
            f"against {expected:.1f} expected from the local trend of the surrounding "
            f"distribution — an excess of {excess:+.1f} accounts "
            f"(p = {p_value:.4f}). This is a potential threshold-evasion pattern and "
            f"requires cross-account behavioural and relational evidence."
        )

    return ThresholdEvasionResult(
        threshold=theta, window=(win_lo_bp / 10000, theta), bin_width=bin_width,
        eligible_accounts=len(eligible), excluded_unreliable=excluded,
        observed_count=observed, expected_count=expected, excess_count=excess,
        excess_ratio=excess_ratio, p_value=p_value, bunching_score=score,
        signal_band=band, reliable=True, reason="", explanation=explanation,
        caveat=caveat, bins=bins, account_signals=signals,
    )
