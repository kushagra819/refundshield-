"""Phase 1 verification — the synthetic world must be correct and reproducible.

The hero scenario's five return rates appear verbatim in the RefundShield pitch
deck, so they are asserted exactly. If these tests fail, the demo is wrong.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app.data.generator import (
    HOUSEHOLD_ACCOUNTS,
    ISOLATED_ACCOUNT,
    N_ACCOUNTS,
    RING_ACCOUNTS,
    RING_ADDRESS,
    RING_DEVICE,
    RING_DEVICE_MEMBERS,
    generate,
)
from app.domain.models import Cohort, ScenarioId

EXPECTED_RING_RATES = {
    "ACC-1032": 18.4,
    "ACC-1047": 18.8,
    "ACC-1051": 19.0,
    "ACC-1062": 18.6,
    "ACC-1078": 19.1,
}


def rate_of(ds, account_id: str) -> float:
    n_orders = sum(1 for o in ds.orders if o.account_id == account_id)
    n_returns = sum(1 for r in ds.returns if r.account_id == account_id)
    return round(100.0 * n_returns / n_orders, 1) if n_orders else 0.0


@pytest.fixture(scope="module")
def worlds():
    return {s: generate(s) for s in ScenarioId}


# -- structural integrity ---------------------------------------------------
def test_every_scenario_has_the_same_account_count(worlds):
    for scenario, ds in worlds.items():
        assert len(ds.accounts) == N_ACCOUNTS, scenario


def test_account_ids_unique_and_referentially_sound(worlds):
    for scenario, ds in worlds.items():
        ids = [a.account_id for a in ds.accounts]
        assert len(ids) == len(set(ids)), scenario

        known_accounts = set(ids)
        known_orders = {o.order_id for o in ds.orders}
        assert len({o.order_id for o in ds.orders}) == len(ds.orders), scenario
        assert len({r.return_id for r in ds.returns}) == len(ds.returns), scenario

        for o in ds.orders:
            assert o.account_id in known_accounts
        for r in ds.returns:
            assert r.order_id in known_orders
            assert r.account_id in known_accounts


def test_one_return_per_order_at_most(worlds):
    for scenario, ds in worlds.items():
        order_ids = [r.order_id for r in ds.returns]
        assert len(order_ids) == len(set(order_ids)), scenario


def test_generation_is_deterministic():
    a, b = generate(ScenarioId.COORDINATED), generate(ScenarioId.COORDINATED)
    assert [x.order_id for x in a.orders] == [x.order_id for x in b.orders]
    assert [x.return_id for x in a.returns] == [x.return_id for x in b.returns]
    assert [x.refund_inr for x in a.returns] == [x.refund_inr for x in b.returns]


def test_volumes_are_in_a_sensible_range(worlds):
    for scenario, ds in worlds.items():
        assert 600 <= len(ds.orders) <= 1400, (scenario, len(ds.orders))
        assert 90 <= len(ds.returns) <= 190, (scenario, len(ds.returns))


def test_no_future_dates(worlds):
    for ds in worlds.values():
        for o in ds.orders:
            assert o.placed_on <= ds.generated_on
        for r in ds.returns:
            assert r.filed_on <= ds.generated_on


# -- the hero scenario ------------------------------------------------------
def test_ring_return_rates_match_the_deck_exactly(worlds):
    ds = worlds[ScenarioId.COORDINATED]
    actual = {aid: rate_of(ds, aid) for aid in RING_ACCOUNTS}
    assert actual == EXPECTED_RING_RATES


def test_every_ring_account_sits_below_the_threshold(worlds):
    ds = worlds[ScenarioId.COORDINATED]
    for aid in RING_ACCOUNTS:
        assert rate_of(ds, aid) < 20.0


def test_ring_shares_device_and_address(worlds):
    ds = worlds[ScenarioId.COORDINATED]
    index = ds.account_index()
    on_device = [a for a in RING_ACCOUNTS if RING_DEVICE in index[a].device_ids]
    at_address = [a for a in RING_ACCOUNTS if index[a].address_id == RING_ADDRESS]
    assert len(on_device) == 3
    assert len(at_address) == 3
    assert set(on_device) == RING_DEVICE_MEMBERS
    # no single attribute links all five — that is the realistic case
    assert len(on_device) < len(RING_ACCOUNTS)
    assert len(at_address) < len(RING_ACCOUNTS)


def test_ring_claims_fall_inside_a_tight_window(worlds):
    ds = worlds[ScenarioId.COORDINATED]
    filed = [r.filed_on for r in ds.returns if r.account_id in set(RING_ACCOUNTS)]
    assert filed
    assert (max(filed) - min(filed)).days <= 8


def test_ring_concentrates_on_a_narrow_product_set(worlds):
    ds = worlds[ScenarioId.COORDINATED]
    ring = set(RING_ACCOUNTS)
    cats = {o.category for o in ds.orders if o.account_id in ring}
    assert cats == {"Electronics", "Small Appliances"}


def test_ring_absent_from_other_scenarios(worlds):
    for scenario in (ScenarioId.NORMAL, ScenarioId.HOUSEHOLD, ScenarioId.ISOLATED):
        ds = worlds[scenario]
        assert not [a for a in ds.accounts if a.cohort is Cohort.RING], scenario


# -- the false-positive control --------------------------------------------
def test_household_shares_entities_but_behaves_normally(worlds):
    ds = worlds[ScenarioId.HOUSEHOLD]
    index = ds.account_index()
    members = [index[a] for a in HOUSEHOLD_ACCOUNTS]

    assert len({m.address_id for m in members}) == 1          # one home
    assert all("DEV-004" in m.device_ids for m in members)    # one shared tablet

    for m in members:
        assert rate_of(ds, m.account_id) < 18.0               # ordinary return rates

    ring_like_cats = {"Electronics", "Small Appliances"}
    cats = {o.category for o in ds.orders if o.account_id in set(HOUSEHOLD_ACCOUNTS)}
    assert len(cats - ring_like_cats) >= 3                    # shops broadly

    filed = [r.filed_on for r in ds.returns if r.account_id in set(HOUSEHOLD_ACCOUNTS)]
    assert (max(filed) - min(filed)).days > 60                # scattered timing


# -- the individual-abuse control ------------------------------------------
def test_isolated_abuser_is_high_rate_and_unconnected(worlds):
    ds = worlds[ScenarioId.ISOLATED]
    index = ds.account_index()
    abuser = index[ISOLATED_ACCOUNT]

    assert rate_of(ds, ISOLATED_ACCOUNT) > 25.0               # clearly above threshold

    others = [a for a in ds.accounts if a.account_id != ISOLATED_ACCOUNT]
    assert not [a for a in others if a.address_id == abuser.address_id]
    shared_devices = set(abuser.device_ids)
    assert not [a for a in others if shared_devices & set(a.device_ids)]

    claims = [r.claim_type for r in ds.returns if r.account_id == ISOLATED_ACCOUNT]
    assert sum(1 for c in claims if c in ("Damaged item", "Empty box")) == len(claims)


# -- privacy ----------------------------------------------------------------
def test_identifiers_are_synthetic(worlds):
    ds = worlds[ScenarioId.COORDINATED]
    for a in ds.accounts:
        assert a.account_id.startswith("ACC-")
        assert a.address_id.startswith("ADDR-")
        assert all(d.startswith("DEV-") for d in a.device_ids)
    for o in ds.orders:
        assert o.order_id.startswith("ORD-")
    for r in ds.returns:
        assert r.return_id.startswith("RET-")
