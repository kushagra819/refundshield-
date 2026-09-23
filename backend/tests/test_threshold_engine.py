"""Phase 3 verification — the threshold-evasion engine.

Covers the twelve required cases plus regression guards for the design decisions
that make the engine work (trend baseline, population gate, no contamination of
the Phase 2 individual score).
"""
from __future__ import annotations

import sys
from dataclasses import replace
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app.config import SETTINGS
from app.data.generator import RING_ACCOUNTS, generate
from app.domain.models import Cohort, ScenarioId
from app.engines import threshold_engine as te
from app.engines.features import AccountFeatures, build_features
from app.engines.individual_risk import score_all

THETA = SETTINGS.threshold


def make_feature(account_id: str, rate: float, orders: int = 20) -> AccountFeatures:
    """A minimal synthetic feature row — only the fields the engine reads."""
    return AccountFeatures(
        account_id=account_id, cohort=Cohort.NORMAL, account_age_days=400,
        order_count=orders, return_count=int(round(rate * orders)),
        return_rate=rate, rate_is_reliable=orders >= 5,
        order_value_total=100000.0, refund_value_total=1000.0,
        refund_value_share=0.01, high_value_return_share=0.0,
        claim_type_counts={}, dominant_claim_type=None, claim_type_concentration=0.0,
        empty_box_count=0, empty_box_share=0.0, damage_count=0, damage_share=0.0,
        recent_rate=rate, prior_rate=rate, recent_orders=orders, prior_orders=orders,
        recent_return_span_days=0, rate_trajectory=1.0, trajectory_is_reliable=False,
        device_ids=["DEV-999"], address_id="ADDR-999", categories=["Fashion"],
        first_order_on=date(2025, 1, 1), last_return_on=date(2026, 1, 1),
    )


def population(rates: list[float], orders: int = 20) -> dict[str, AccountFeatures]:
    return {f"ACC-{9000+i}": make_feature(f"ACC-{9000+i}", r, orders)
            for i, r in enumerate(rates)}


def declining_population(extra_in_window: int = 0) -> dict[str, AccountFeatures]:
    """A realistic right-skewed population, optionally with accounts parked in the window."""
    rates: list[float] = []
    for pct, n in [(2, 10), (4, 9), (6, 8), (8, 7), (10, 6), (12, 5),
                   (14, 4), (16, 3), (17, 2), (21, 2), (24, 1), (28, 1)]:
        rates += [pct / 100] * n
    rates += [0.185] * extra_in_window
    return population(rates)


@pytest.fixture(scope="module")
def scenarios():
    out = {}
    for s in ScenarioId:
        ds = generate(s)
        feats, ctx = build_features(ds)
        out[s] = (feats, ctx, te.analyse(feats))
    return out


# ==========================================================================
# TEST 1-4, 10 — scenario separation
# ==========================================================================
def test_1_coordinated_produces_a_strong_signal(scenarios):
    _, _, r = scenarios[ScenarioId.COORDINATED]
    assert r.reliable
    assert r.bunching_score >= 60.0, r.bunching_score
    assert r.signal_band in ("HIGH", "VERY HIGH")
    assert r.excess_count > 3.0


def test_2_normal_produces_a_weak_signal(scenarios):
    _, _, r = scenarios[ScenarioId.NORMAL]
    assert r.reliable
    assert r.bunching_score < 30.0, r.bunching_score
    assert r.signal_band == "LOW"


def test_3_household_produces_a_weak_signal(scenarios):
    """Sharing an address must not create a population-level threshold pattern."""
    _, _, r = scenarios[ScenarioId.HOUSEHOLD]
    assert r.reliable
    assert r.bunching_score < 30.0, r.bunching_score
    assert r.signal_band == "LOW"


def test_4_isolated_abuse_does_not_become_a_population_signal(scenarios):
    """One high-risk individual is an individual problem, not a bunching pattern."""
    _, _, r = scenarios[ScenarioId.ISOLATED]
    assert r.reliable
    assert r.bunching_score < 30.0, r.bunching_score


def test_10_hero_case_is_clearly_elevated(scenarios):
    feats, _, r = scenarios[ScenarioId.COORDINATED]
    assert r.observed_count == 6
    assert r.expected_count < 2.0
    assert r.p_value < 0.01
    for aid in RING_ACCOUNTS:
        sig = r.account_signals[aid]
        assert sig.in_window, aid
        assert 0.18 <= sig.return_rate < 0.20


def test_coordinated_dominates_every_other_scenario(scenarios):
    coord = scenarios[ScenarioId.COORDINATED][2].bunching_score
    for s in (ScenarioId.NORMAL, ScenarioId.HOUSEHOLD, ScenarioId.ISOLATED):
        assert coord > scenarios[s][2].bunching_score + 50.0, s


# ==========================================================================
# TEST 5 — threshold boundary
# ==========================================================================
def test_5_rate_exactly_at_threshold_is_not_inside_the_window():
    feats = declining_population()
    feats["ACC-A"] = make_feature("ACC-A", THETA - 0.0001)   # 19.99%
    feats["ACC-B"] = make_feature("ACC-B", THETA)            # 20.00%
    feats["ACC-C"] = make_feature("ACC-C", THETA + 0.0001)   # 20.01%
    r = te.analyse(feats, threshold=THETA)
    assert r.account_signals["ACC-A"].in_window is True
    assert r.account_signals["ACC-B"].in_window is False
    assert r.account_signals["ACC-C"].in_window is False


def test_5b_window_is_half_open_on_both_ends():
    feats = declining_population()
    lo = THETA - te.DEFAULT_WINDOW_WIDTH
    feats["ACC-LO"] = make_feature("ACC-LO", lo)              # exactly 18% -> inside
    feats["ACC-BELOW"] = make_feature("ACC-BELOW", lo - 0.0001)
    r = te.analyse(feats)
    assert r.account_signals["ACC-LO"].in_window is True
    assert r.account_signals["ACC-BELOW"].in_window is False
    assert r.window == (pytest.approx(lo), pytest.approx(THETA))


# ==========================================================================
# TEST 6 — sparse population
# ==========================================================================
def test_6_sparse_population_returns_insufficient_data():
    feats = population([0.05, 0.19, 0.19, 0.19])
    r = te.analyse(feats)
    assert r.reliable is False
    assert te.INSUFFICIENT in r.explanation
    assert r.bunching_score == 0.0
    assert r.signal_band == "LOW"
    assert "minimum" in r.reason


def test_6b_unreliable_accounts_are_excluded_not_counted():
    feats = declining_population()
    for i in range(15):                       # tiny accounts parked at 19%
        feats[f"ACC-T{i}"] = make_feature(f"ACC-T{i}", 0.19, orders=2)
    r = te.analyse(feats)
    assert r.excluded_unreliable == 15
    assert r.observed_count == 0, "2-order accounts must not drive bunching"


# ==========================================================================
# TEST 7 — sparse / zero-count bins
# ==========================================================================
def test_7_empty_reference_region_is_reported_not_divided_by():
    # 40 accounts all at 1%, plus 4 parked at 19% — reference region is empty
    feats = population([0.01] * 40 + [0.19] * 4)
    r = te.analyse(feats)
    assert r.reliable is False
    assert "reference region" in r.reason
    assert r.bunching_score == 0.0


def test_7b_zero_counts_never_divide_by_zero():
    for extra in range(0, 9):
        feats = declining_population(extra_in_window=extra)
        r = te.analyse(feats)
        assert r.expected_count >= te.MIN_EXPECTED_TOTAL
        assert 0.0 <= r.bunching_score <= 100.0
        assert not (r.bunching_score != r.bunching_score)   # not NaN


def test_7c_expected_count_is_floored():
    feats = declining_population(extra_in_window=2)
    r = te.analyse(feats)
    assert r.expected_count >= te.MIN_EXPECTED_TOTAL


# ==========================================================================
# TEST 8 — sample-size sensitivity
# ==========================================================================
def test_8_small_population_cannot_manufacture_a_strong_signal():
    """The same 3x excess ratio must score far lower in a small population."""
    small = population([0.02] * 6 + [0.04] * 5 + [0.06] * 4 + [0.08] * 3
                       + [0.10] * 3 + [0.12] * 2 + [0.14] * 2 + [0.16] * 2
                       + [0.185] * 2)
    r_small = te.analyse(small)
    big = declining_population(extra_in_window=6)
    r_big = te.analyse(big)
    assert r_small.bunching_score < r_big.bunching_score
    assert r_small.bunching_score < 60.0, r_small.bunching_score


def test_8b_signal_grows_monotonically_with_the_excess():
    previous = -1.0
    for extra in range(0, 9):
        r = te.analyse(declining_population(extra_in_window=extra))
        assert r.bunching_score >= previous - 1e-9, (extra, r.bunching_score)
        previous = r.bunching_score


def test_8c_minimum_eligible_gate_is_enforced():
    feats = population([0.10] * (te.MIN_ELIGIBLE_ACCOUNTS - 1))
    assert te.analyse(feats).reliable is False
    feats2 = population([0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14, 0.16] * 4)
    assert te.analyse(feats2).reliable is True


# ==========================================================================
# TEST 9 — threshold configurability
# ==========================================================================
def test_9_changing_the_threshold_recalculates(scenarios):
    feats, _, base = scenarios[ScenarioId.COORDINATED]
    assert base.threshold == pytest.approx(0.20)
    at_25 = te.analyse(feats, threshold=0.25)
    at_15 = te.analyse(feats, threshold=0.15)
    assert at_25.threshold == pytest.approx(0.25)
    assert at_15.threshold == pytest.approx(0.15)
    assert at_25.window == (pytest.approx(0.23), pytest.approx(0.25))
    # the ring is parked below 20%, so moving the line away from it kills the signal
    assert at_25.bunching_score < base.bunching_score
    assert at_15.bunching_score < base.bunching_score


def test_9b_threshold_is_not_hardcoded_anywhere(scenarios):
    feats, _, _ = scenarios[ScenarioId.COORDINATED]
    seen = {te.analyse(feats, threshold=t).window for t in (0.15, 0.20, 0.25, 0.30)}
    assert len(seen) == 4


def test_9c_window_width_is_configurable(scenarios):
    feats, _, _ = scenarios[ScenarioId.COORDINATED]
    wide = te.analyse(feats, window_width=0.04)
    assert wide.window[0] == pytest.approx(0.16)
    assert wide.observed_count >= 6


# ==========================================================================
# TEST 11 — no contamination of the Phase 2 individual score
# ==========================================================================
def test_11_individual_scores_are_untouched_by_the_threshold_engine():
    ds = generate(ScenarioId.COORDINATED)
    feats, ctx = build_features(ds)
    before = {k: v.score for k, v in score_all(feats, ctx).items()}
    te.analyse(feats)
    te.analyse(feats, threshold=0.15)
    after = {k: v.score for k, v in score_all(feats, ctx).items()}
    assert before == after


def test_11b_ring_individual_scores_still_low_and_unchanged():
    ds = generate(ScenarioId.COORDINATED)
    feats, ctx = build_features(ds)
    risks = score_all(feats, ctx)
    for aid in RING_ACCOUNTS:
        assert risks[aid].band == "LOW"
        assert risks[aid].score <= 27.0
    # and the threshold engine says something quite different about them
    r = te.analyse(feats)
    assert all(r.account_signals[a].signal > 40.0 for a in RING_ACCOUNTS)


def test_11c_threshold_engine_does_not_mutate_features():
    ds = generate(ScenarioId.COORDINATED)
    feats, _ = build_features(ds)
    snapshot = {k: v.to_dict() for k, v in feats.items()}
    te.analyse(feats)
    assert {k: v.to_dict() for k, v in feats.items()} == snapshot


# ==========================================================================
# TEST 12 — determinism
# ==========================================================================
def test_12_same_input_same_output():
    ds = generate(ScenarioId.COORDINATED)
    feats, _ = build_features(ds)
    a = te.analyse(feats).to_dict()
    b = te.analyse(feats).to_dict()
    assert a == b


def test_12b_regenerated_dataset_gives_the_same_result():
    a_feats, _ = build_features(generate(ScenarioId.COORDINATED))
    b_feats, _ = build_features(generate(ScenarioId.COORDINATED))
    assert te.analyse(a_feats).to_dict() == te.analyse(b_feats).to_dict()


# ==========================================================================
# Design-decision regression guards
# ==========================================================================
def test_flat_baseline_would_miss_the_hero_case(scenarios):
    """Documents WHY the baseline is a trend fit and not a neighbourhood average.

    If someone later 'simplifies' the baseline to a flat mean of the reference
    bins, the coordinated scenario stops registering entirely. This test records
    that fact so the decision is not quietly undone.
    """
    _, _, r = scenarios[ScenarioId.COORDINATED]
    ref = [b.count for b in r.bins if b.role == "reference"]
    window_bins = [b for b in r.bins if b.role == "window"]
    flat_expected = (sum(ref) / len(ref)) * len(window_bins)
    assert flat_expected > r.observed_count, (
        "flat baseline predicts more than observed -> no signal at all"
    )
    assert r.expected_count < r.observed_count, "trend baseline does detect it"


def test_population_gate_suppresses_proximity_alone(scenarios):
    """An account at ~19% in an ordinary population must NOT score highly."""
    normal_feats, _, normal_r = scenarios[ScenarioId.NORMAL]
    in_window = [s for s in normal_r.account_signals.values() if s.in_window]
    assert in_window, "expected at least one ordinary account inside the window"
    for s in in_window:
        assert s.signal <= 100 * te.GATE_FLOOR, (s.account_id, s.signal)
        assert s.band == "LOW"


def test_same_proximity_scores_differently_by_population(scenarios):
    """The core claim: the population, not the account, decides the signal."""
    _, _, normal_r = scenarios[ScenarioId.NORMAL]
    _, _, coord_r = scenarios[ScenarioId.COORDINATED]
    normal_in = [s for s in normal_r.account_signals.values() if s.in_window]
    coord_in = [s for s in coord_r.account_signals.values() if s.in_window]
    assert min(s.signal for s in coord_in) > max(s.signal for s in normal_in) + 20.0


def test_accounts_outside_the_window_get_no_signal(scenarios):
    for _, _, r in scenarios.values():
        for s in r.account_signals.values():
            if not s.in_window:
                assert s.signal == 0.0
                assert s.proximity == 0.0


# ==========================================================================
# Output contract and responsible language
# ==========================================================================
def test_result_serialises_with_every_documented_field(scenarios):
    _, _, r = scenarios[ScenarioId.COORDINATED]
    d = r.to_dict()
    for key in ("threshold", "window", "eligible_accounts", "observed_count",
                "expected_count", "excess_count", "bunching_score", "signal_band",
                "explanation", "caveat", "bins", "account_signals", "p_value",
                "baseline_method", "notice", "reliable"):
        assert key in d, key


def test_bins_are_labelled_for_the_ui(scenarios):
    _, _, r = scenarios[ScenarioId.COORDINATED]
    roles = {b.role for b in r.bins}
    assert {"window", "reference", "guard"} <= roles
    assert len([b for b in r.bins if b.role == "window"]) == 2
    for b in r.bins:
        assert b.count >= 0
        assert b.to_dict()["label"]        # label is rendered in the API payload


def test_language_never_asserts_fraud(scenarios):
    """The explanation must never assert fraud.

    Checked on the explanation only: the caveat deliberately CONTAINS the word
    "fraudulent", inside the negation "does not determine that any individual
    customer is fraudulent", which is exactly the wording we want.
    """
    banned = ["fraud detected", "is fraudulent", "are fraudulent", "proves fraud",
              "confirmed fraud", "guilty", "definitely"]
    for _, _, r in scenarios.values():
        text = r.explanation.lower()
        for phrase in banned:
            assert phrase not in text, (phrase, r.explanation)
    # and the caveat must carry the disclaimer, negation included
    for _, _, r in scenarios.values():
        assert "does not determine that any individual customer is fraudulent" in r.caveat


def test_every_result_carries_the_caveat(scenarios):
    for _, _, r in scenarios.values():
        assert "does not determine" in r.caveat
        assert "not a validated" in r.notice.lower()


def test_elevated_result_asks_for_corroborating_evidence(scenarios):
    _, _, r = scenarios[ScenarioId.COORDINATED]
    assert "requires cross-account" in r.explanation.lower()
    assert "potential threshold-evasion pattern" in r.explanation.lower()
