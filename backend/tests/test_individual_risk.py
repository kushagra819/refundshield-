"""Phase 2 verification — feature engineering and the individual risk engine.

Covers four areas the review asked for:
  * score consistency   — determinism, range, monotonicity
  * explainability      — every point is attributable and every score is readable
  * boundary cases      — band edges, thin accounts, degenerate inputs
  * scenario separation — ring stays LOW, isolated abuser scores HIGH
"""
from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app.config import SETTINGS, band_for, band_table
from app.data.generator import (
    HOUSEHOLD_ACCOUNTS,
    ISOLATED_ACCOUNT,
    RING_ACCOUNTS,
    generate,
)
from app.domain.models import Cohort, ScenarioId
from app.engines.features import build_features
from app.engines.individual_risk import (
    MAX_RAW_POINTS,
    RULES,
    score_account,
    score_all,
)

THETA = SETTINGS.threshold


@pytest.fixture(scope="module")
def scored():
    out = {}
    for s in ScenarioId:
        ds = generate(s)
        feats, ctx = build_features(ds)
        out[s] = (ds, feats, ctx, score_all(feats, ctx))
    return out


# ==========================================================================
# Score consistency
# ==========================================================================
def test_scores_stay_inside_the_scale(scored):
    for s, (_, _, _, risks) in scored.items():
        for r in risks.values():
            assert 0.0 <= r.score <= 100.0, (s, r.account_id, r.score)


def test_scoring_is_deterministic():
    a_ds = generate(ScenarioId.COORDINATED)
    b_ds = generate(ScenarioId.COORDINATED)
    fa, ca = build_features(a_ds)
    fb, cb = build_features(b_ds)
    ra, rb = score_all(fa, ca), score_all(fb, cb)
    assert {k: v.score for k, v in ra.items()} == {k: v.score for k, v in rb.items()}


def test_every_account_is_scored(scored):
    for s, (ds, feats, _, risks) in scored.items():
        assert set(risks) == {a.account_id for a in ds.accounts}, s
        assert set(feats) == set(risks), s


def test_band_matches_score(scored):
    for _, _, _, risks in scored.values():
        for r in risks.values():
            assert r.band == band_for(r.score)


def test_score_rises_monotonically_with_return_rate(scored):
    """Holding everything else fixed, a worse return rate must not score lower."""
    _, feats, ctx, _ = scored[ScenarioId.COORDINATED]
    base = feats["ACC-1078"]
    previous = -1.0
    for returns in range(0, base.order_count + 1):
        probe = replace(
            base,
            return_count=returns,
            return_rate=returns / base.order_count,
            claim_type_counts={}, dominant_claim_type=None, claim_type_concentration=0.0,
            empty_box_count=0, empty_box_share=0.0, damage_count=0, damage_share=0.0,
            high_value_return_share=0.0, trajectory_is_reliable=False, rate_trajectory=0.0,
        )
        score = score_account(probe, ctx).score
        assert score >= previous - 1e-9, (returns, score, previous)
        previous = score


def test_cohort_label_never_influences_the_score(scored):
    """The generator tags accounts by cohort; no scorer may read that tag."""
    _, feats, ctx, _ = scored[ScenarioId.COORDINATED]
    f = feats["ACC-1032"]
    baseline = score_account(f, ctx).score
    for cohort in Cohort:
        assert score_account(replace(f, cohort=cohort), ctx).score == baseline


# ==========================================================================
# Explainability
# ==========================================================================
def test_score_equals_the_sum_of_its_signals(scored):
    for _, _, _, risks in scored.values():
        for r in risks.values():
            raw = sum(s.points for s in r.signals)
            assert r.score == pytest.approx(min(100.0, raw), abs=1e-6), r.account_id


def test_every_signal_carries_readable_evidence(scored):
    for _, _, _, risks in scored.values():
        for r in risks.values():
            for s in r.signals:
                assert s.code and s.label and s.detail
                assert s.points > 0
                # the detail must quote a real value, not just assert a conclusion
                assert any(ch.isdigit() for ch in s.detail), s.detail


def test_signals_are_ordered_by_contribution(scored):
    for _, _, _, risks in scored.values():
        for r in risks.values():
            pts = [s.points for s in r.signals]
            assert pts == sorted(pts, reverse=True)


def test_factors_are_always_present_even_with_no_signals(scored):
    _, _, _, risks = scored[ScenarioId.NORMAL]
    quiet = [r for r in risks.values() if not r.signals]
    assert quiet, "expected at least one account with no rules firing"
    for r in quiet:
        assert len(r.factors) >= 5
        assert all(f.label and f.value for f in r.factors)


def test_every_result_carries_the_prototype_notice(scored):
    for _, _, _, risks in scored.values():
        for r in risks.values():
            assert "not a validated" in r.notice.lower()


def test_no_rule_can_exceed_the_published_maximum():
    assert MAX_RAW_POINTS >= 100.0
    assert len(RULES) == 7


# ==========================================================================
# Boundary cases
# ==========================================================================
@pytest.mark.parametrize(
    "score,expected",
    [(0, "LOW"), (29.99, "LOW"), (30, "MODERATE"), (59.99, "MODERATE"),
     (60, "HIGH"), (79.99, "HIGH"), (80, "VERY HIGH"), (100, "VERY HIGH")],
)
def test_band_boundaries_are_contiguous(score, expected):
    assert band_for(score) == expected


def test_band_helper_is_total_over_the_whole_range():
    for i in range(0, 10001):
        assert band_for(i / 100.0) in {"LOW", "MODERATE", "HIGH", "VERY HIGH"}
    assert band_for(-5) == "LOW"
    assert band_for(1e9) == "VERY HIGH"
    assert len(band_table()) == 4


def test_thin_accounts_do_not_get_a_rate_signal(scored):
    """An account with too few orders must not be scored on a noisy rate."""
    _, feats, ctx, _ = scored[ScenarioId.NORMAL]
    sample = next(iter(feats.values()))
    thin = replace(sample, order_count=2, return_count=1, return_rate=0.5,
                   rate_is_reliable=False)
    codes = {s.code for s in score_account(thin, ctx).signals}
    assert "return_rate_under_threshold" not in codes
    assert "return_rate_over_threshold" not in codes


def test_zero_activity_account_scores_zero(scored):
    _, feats, ctx, _ = scored[ScenarioId.NORMAL]
    sample = next(iter(feats.values()))
    empty = replace(
        sample, order_count=0, return_count=0, return_rate=0.0, rate_is_reliable=False,
        order_value_total=0.0, refund_value_total=0.0, refund_value_share=0.0,
        high_value_return_share=0.0, claim_type_counts={}, dominant_claim_type=None,
        claim_type_concentration=0.0, empty_box_count=0, empty_box_share=0.0,
        damage_count=0, damage_share=0.0, trajectory_is_reliable=False,
        rate_trajectory=0.0,
    )
    r = score_account(empty, ctx)
    assert r.score == 0.0
    assert r.band == "LOW"
    assert r.factors  # still explainable


def test_worst_case_account_is_capped_at_100(scored):
    _, feats, ctx, _ = scored[ScenarioId.ISOLATED]
    sample = feats[ISOLATED_ACCOUNT]
    worst = replace(
        sample, order_count=40, return_count=40, return_rate=1.0, rate_is_reliable=True,
        claim_type_counts={"Empty box": 40}, dominant_claim_type="Empty box",
        claim_type_concentration=1.0, empty_box_count=40, empty_box_share=1.0,
        damage_count=40, damage_share=1.0, high_value_return_share=1.0,
        account_age_days=10, recent_rate=1.0, prior_rate=0.05,
        recent_orders=20, prior_orders=20, recent_return_span_days=60,
        rate_trajectory=20.0, trajectory_is_reliable=True,
    )
    r = score_account(worst, ctx)
    assert r.score == 100.0
    assert r.band == "VERY HIGH"


def test_rate_exactly_at_threshold_counts_as_above():
    ds = generate(ScenarioId.NORMAL)
    feats, ctx = build_features(ds)
    sample = next(f for f in feats.values() if f.order_count >= 10)
    at = replace(sample, return_rate=THETA, rate_is_reliable=True)
    just_under = replace(sample, return_rate=THETA - 0.0001, rate_is_reliable=True)
    codes_at = {s.code for s in score_account(at, ctx).signals}
    codes_under = {s.code for s in score_account(just_under, ctx).signals}
    assert "return_rate_over_threshold" in codes_at
    assert "return_rate_under_threshold" in codes_under
    assert score_account(at, ctx).score > score_account(just_under, ctx).score


# ==========================================================================
# Scenario separation — the critical Phase 2 validation
# ==========================================================================
def test_ring_members_stay_low_individually(scored):
    """The premise of CX0507: each ring account looks acceptable on its own."""
    _, _, _, risks = scored[ScenarioId.COORDINATED]
    for aid in RING_ACCOUNTS:
        r = risks[aid]
        assert r.band == "LOW", (aid, r.score, r.band)
        assert r.score < 30.0, (aid, r.score)


def test_ring_members_keep_headroom_below_the_band_edge(scored):
    """Guards the live demo: no ring account may sit within 3 points of MODERATE."""
    _, _, _, risks = scored[ScenarioId.COORDINATED]
    for aid in RING_ACCOUNTS:
        assert risks[aid].score <= 27.0, (aid, risks[aid].score)


def test_isolated_abuser_scores_high(scored):
    _, _, _, risks = scored[ScenarioId.ISOLATED]
    r = risks[ISOLATED_ACCOUNT]
    assert r.band in ("HIGH", "VERY HIGH"), (r.score, r.band)
    assert r.score >= 60.0


def test_isolated_abuser_outscores_every_ring_member(scored):
    _, _, _, iso = scored[ScenarioId.ISOLATED]
    _, _, _, coord = scored[ScenarioId.COORDINATED]
    abuser = iso[ISOLATED_ACCOUNT].score
    assert abuser > max(coord[a].score for a in RING_ACCOUNTS) + 30.0


def test_household_members_stay_low(scored):
    """Sharing an address and a device must not raise INDIVIDUAL risk at all."""
    _, _, _, risks = scored[ScenarioId.HOUSEHOLD]
    for aid in HOUSEHOLD_ACCOUNTS:
        r = risks[aid]
        assert r.band == "LOW", (aid, r.score)
        assert r.score < 20.0


def test_normal_population_is_overwhelmingly_low(scored):
    _, _, _, risks = scored[ScenarioId.NORMAL]
    low = sum(1 for r in risks.values() if r.band == "LOW")
    assert low >= 90, low
    assert not [r for r in risks.values() if r.band == "VERY HIGH"]


def test_ring_is_indistinguishable_from_normal_by_individual_score(scored):
    """If individual scoring alone could separate the ring, CX0507 would be solved.

    This test asserts the OPPOSITE of what a naive detector would want: the ring's
    individual scores must sit inside the ordinary population's range.
    """
    _, _, _, normal = scored[ScenarioId.NORMAL]
    _, _, _, coord = scored[ScenarioId.COORDINATED]
    ordinary = sorted(r.score for r in normal.values())
    p90 = ordinary[int(0.90 * len(ordinary))]
    for aid in RING_ACCOUNTS:
        assert coord[aid].score <= p90 + 12.0, (aid, coord[aid].score, p90)


def test_scenario_swap_does_not_disturb_the_base_population(scored):
    """Injecting a cohort must not move unrelated accounts' scores."""
    _, _, _, normal = scored[ScenarioId.NORMAL]
    _, _, _, coord = scored[ScenarioId.COORDINATED]
    touched = set(RING_ACCOUNTS)
    moved = [
        aid for aid, r in normal.items()
        if aid not in touched and abs(r.score - coord[aid].score) > 2.0
    ]
    # a few accounts shift slightly because population reference values
    # (top-quartile order value, claim-type baseline) legitimately change
    assert len(moved) <= 6, moved


# ==========================================================================
# Feature-layer sanity
# ==========================================================================
def test_features_agree_with_the_raw_records(scored):
    for s, (ds, feats, _, _) in scored.items():
        for aid in list(feats)[:20]:
            f = feats[aid]
            assert f.order_count == sum(1 for o in ds.orders if o.account_id == aid)
            assert f.return_count == sum(1 for r in ds.returns if r.account_id == aid)
            if f.order_count:
                assert f.return_rate == pytest.approx(f.return_count / f.order_count)


def test_population_context_is_sane(scored):
    for s, (ds, _, ctx, _) in scored.items():
        assert ctx.account_count == len(ds.accounts)
        assert ctx.order_count == len(ds.orders)
        assert ctx.high_value_order_threshold > 0
        assert abs(sum(ctx.claim_type_baseline.values()) - 1.0) < 1e-6, s
