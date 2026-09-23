"""RefundShield — individual return-risk engine.

A transparent, additive, rule-based score in the range 0-100. Every rule states
its own trigger, its point value and the underlying numbers that made it fire,
so an investigator can check the reasoning rather than trust a number.

THIS IS NOT A TRAINED MODEL. No labelled fraud outcomes exist for this synthetic
data, so nothing here is fitted, and no accuracy, precision or recall is claimed.

DESIGN NOTE — why a below-threshold return rate scores so little
---------------------------------------------------------------
The seller's own policy says a return rate under the threshold is acceptable. An
account sitting at 18.8% against a 20% policy is, by the seller's own definition,
behaving within bounds — so the rate contributes at most 12 of 100 points while
it stays under. That is precisely why a ring parked below the threshold cannot be
found by individual scoring, and why the coordination layer exists.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from ..config import SCORING_NOTICE, SETTINGS, band_for
from .features import AccountFeatures, PopulationContext

# --------------------------------------------------------------------------
# Rule trigger constants — every threshold used by a rule lives here
# --------------------------------------------------------------------------
EMPTY_BOX_MIN_COUNT = 2
EMPTY_BOX_MIN_SHARE = 0.30
DAMAGE_MIN_COUNT = 3
DAMAGE_MIN_SHARE = 0.45
CONCENTRATION_MIN_COUNT = 4
CONCENTRATION_MIN_SHARE = 0.70
HIGH_VALUE_MIN_COUNT = 3
HIGH_VALUE_MIN_SHARE = 0.60
YOUNG_ACCOUNT_MAX_AGE_DAYS = 90
YOUNG_ACCOUNT_MIN_RETURNS = 3
TRAJECTORY_MIN_RATIO = 2.0
# A trend has to be sustained. Claims packed into a few days are a BURST, and a
# burst is a coordination-layer signal (several unrelated accounts bursting in
# the same week), not evidence that one person's behaviour has stepped up.
TRAJECTORY_MIN_SPAN_DAYS = 21

THRESHOLD_CROSSED_BONUS = 8.0


@dataclass
class Signal:
    """One rule that fired, with the evidence behind it."""
    code: str
    label: str
    points: float
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "label": self.label,
            "points": round(self.points, 1),
            "detail": self.detail,
        }


@dataclass
class Factor:
    """A neutral feature readout, shown whether or not it contributed points."""
    label: str
    value: str
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"label": self.label, "value": self.value, "note": self.note}


@dataclass
class IndividualRisk:
    account_id: str
    score: float
    band: str
    signals: list[Signal] = field(default_factory=list)
    factors: list[Factor] = field(default_factory=list)
    notice: str = SCORING_NOTICE

    def to_dict(self) -> dict[str, Any]:
        return {
            "account_id": self.account_id,
            "score": round(self.score, 1),
            "band": self.band,
            "signals": [s.to_dict() for s in self.signals],
            "factors": [f.to_dict() for f in self.factors],
            "notice": self.notice,
        }


def _pct(x: float) -> str:
    return f"{x * 100:.1f}%"


# --------------------------------------------------------------------------
# Rules. Each returns a Signal or None.
# --------------------------------------------------------------------------
def _rule_return_rate(f: AccountFeatures, ctx: PopulationContext) -> Signal | None:
    w = SETTINGS.individual
    theta = SETTINGS.threshold
    if not f.rate_is_reliable:
        return None
    if f.return_rate < theta:
        pts = w.rate_below_threshold_max * (f.return_rate / theta)
        if pts < 0.1:
            return None
        return Signal(
            "return_rate_under_threshold",
            "Return rate below seller threshold",
            pts,
            f"{_pct(f.return_rate)} of {f.order_count} orders returned — under the "
            f"{_pct(theta)} policy threshold, so this contributes little on its own.",
        )
    over = (f.return_rate - theta) / theta
    pts = (w.rate_below_threshold_max + THRESHOLD_CROSSED_BONUS
           + min(w.rate_above_threshold_max, over * w.rate_above_threshold_max))
    return Signal(
        "return_rate_over_threshold",
        "Return rate above seller threshold",
        pts,
        f"{_pct(f.return_rate)} of {f.order_count} orders returned — above the "
        f"{_pct(theta)} policy threshold.",
    )


def _rule_empty_box(f: AccountFeatures, ctx: PopulationContext) -> Signal | None:
    if f.empty_box_count < EMPTY_BOX_MIN_COUNT or f.empty_box_share < EMPTY_BOX_MIN_SHARE:
        return None
    base = ctx.claim_type_baseline.get("Empty box", 0.0)
    return Signal(
        "repeated_empty_box",
        "Repeated empty-box claims",
        SETTINGS.individual.repeated_empty_box,
        f"{f.empty_box_count} of {f.return_count} claims are empty-box "
        f"({_pct(f.empty_box_share)} vs {_pct(base)} across all customers).",
    )


def _rule_damage(f: AccountFeatures, ctx: PopulationContext) -> Signal | None:
    if f.damage_count < DAMAGE_MIN_COUNT or f.damage_share < DAMAGE_MIN_SHARE:
        return None
    base = ctx.claim_type_baseline.get("Damaged item", 0.0)
    return Signal(
        "repeated_damage",
        "Repeated damage claims",
        SETTINGS.individual.repeated_damage,
        f"{f.damage_count} of {f.return_count} claims report damage "
        f"({_pct(f.damage_share)} vs {_pct(base)} across all customers).",
    )


def _rule_claim_concentration(f: AccountFeatures, ctx: PopulationContext) -> Signal | None:
    if (f.return_count < CONCENTRATION_MIN_COUNT
            or f.claim_type_concentration < CONCENTRATION_MIN_SHARE):
        return None
    return Signal(
        "claim_type_concentration",
        "Claims concentrated on one reason",
        SETTINGS.individual.claim_type_concentration,
        f"{_pct(f.claim_type_concentration)} of claims use the same reason "
        f"(“{f.dominant_claim_type}”) across {f.return_count} returns.",
    )


def _rule_high_value_skew(f: AccountFeatures, ctx: PopulationContext) -> Signal | None:
    if (f.return_count < HIGH_VALUE_MIN_COUNT
            or f.high_value_return_share < HIGH_VALUE_MIN_SHARE):
        return None
    return Signal(
        "high_value_return_skew",
        "Returns skew to high-value orders",
        SETTINGS.individual.high_value_return_ratio,
        f"{_pct(f.high_value_return_share)} of claims are on orders above "
        f"₹{ctx.high_value_order_threshold:,.0f} (the seller's top order-value quartile).",
    )


def _rule_young_account(f: AccountFeatures, ctx: PopulationContext) -> Signal | None:
    if (f.account_age_days > YOUNG_ACCOUNT_MAX_AGE_DAYS
            or f.return_count < YOUNG_ACCOUNT_MIN_RETURNS):
        return None
    return Signal(
        "young_account_activity",
        "New account already claiming",
        SETTINGS.individual.young_account_activity,
        f"Account is {f.account_age_days} days old and has already filed "
        f"{f.return_count} claims.",
    )


def _rule_trajectory(f: AccountFeatures, ctx: PopulationContext) -> Signal | None:
    if not f.trajectory_is_reliable or f.rate_trajectory < TRAJECTORY_MIN_RATIO:
        return None
    if f.recent_return_span_days < TRAJECTORY_MIN_SPAN_DAYS:
        return None
    if f.prior_rate <= 0:
        detail = (f"Return rate went from 0% to {_pct(f.recent_rate)} between the "
                  f"previous and most recent 120-day windows.")
    else:
        detail = (f"Return rate rose from {_pct(f.prior_rate)} to {_pct(f.recent_rate)} "
                  f"between the previous and most recent 120-day windows.")
    return Signal(
        "sustained_rate_increase",
        "Sustained increase in return rate",
        SETTINGS.individual.behaviour_change,
        detail,
    )


RULES: list[Callable[[AccountFeatures, PopulationContext], Signal | None]] = [
    _rule_return_rate,
    _rule_empty_box,
    _rule_damage,
    _rule_claim_concentration,
    _rule_high_value_skew,
    _rule_young_account,
    _rule_trajectory,
]

# Maximum attainable score before capping — published so the scale is honest.
MAX_RAW_POINTS = (
    SETTINGS.individual.rate_below_threshold_max
    + THRESHOLD_CROSSED_BONUS
    + SETTINGS.individual.rate_above_threshold_max
    + SETTINGS.individual.repeated_empty_box
    + SETTINGS.individual.repeated_damage
    + SETTINGS.individual.claim_type_concentration
    + SETTINGS.individual.high_value_return_ratio
    + SETTINGS.individual.young_account_activity
    + SETTINGS.individual.behaviour_change
)


def _factors(f: AccountFeatures, ctx: PopulationContext) -> list[Factor]:
    """The always-visible readout, including the things that did NOT look unusual."""
    theta = SETTINGS.threshold
    months = f.account_age_days // 30
    if not f.rate_is_reliable:
        rate_note = f"only {f.order_count} orders — too few to score reliably"
    elif f.return_rate >= theta:
        rate_note = f"above the {_pct(theta)} threshold"
    else:
        rate_note = f"below the {_pct(theta)} threshold"

    if f.return_count == 0:
        claim_note = "no claims filed"
    elif f.claim_type_concentration >= CONCENTRATION_MIN_SHARE:
        claim_note = "concentrated on one reason"
    else:
        claim_note = "mixed reasons"

    if not f.trajectory_is_reliable:
        traj = "not enough history"
    elif f.rate_trajectory >= TRAJECTORY_MIN_RATIO:
        traj = "rising"
    else:
        traj = "stable"

    return [
        Factor("Return rate", _pct(f.return_rate), rate_note),
        Factor("Orders / returns", f"{f.order_count} / {f.return_count}", ""),
        Factor("Account age", f"{months} months", ""),
        Factor("Claim reasons", f.dominant_claim_type or "—", claim_note),
        Factor("High-value claim share", _pct(f.high_value_return_share),
               f"top quartile is ₹{ctx.high_value_order_threshold:,.0f}+"),
        Factor("Refund value share", _pct(f.refund_value_share),
               "of this account's total order value"),
        Factor("Rate trajectory", traj, ""),
    ]


def score_account(f: AccountFeatures, ctx: PopulationContext) -> IndividualRisk:
    signals = [s for s in (rule(f, ctx) for rule in RULES) if s is not None]
    total = min(100.0, sum(s.points for s in signals))
    signals.sort(key=lambda s: s.points, reverse=True)
    return IndividualRisk(
        account_id=f.account_id,
        score=total,
        band=band_for(total),
        signals=signals,
        factors=_factors(f, ctx),
    )


def score_all(features: dict[str, AccountFeatures],
              ctx: PopulationContext) -> dict[str, IndividualRisk]:
    return {aid: score_account(f, ctx) for aid, f in features.items()}
