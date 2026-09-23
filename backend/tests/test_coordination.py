"""Phase 4 verification — relationship graph, network evidence, coordination risk.

Covers the 20 required cases, the 5 adversarial scenarios (A-E), the four
architectural cases (A-D), and the API contract.
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app.config import SETTINGS
from app.data.generator import (
    HOUSEHOLD_ACCOUNTS,
    ISOLATED_ACCOUNT,
    RING_ACCOUNTS,
    RING_ADDRESS,
    RING_DEVICE,
    generate,
)
from app.domain.models import (
    Account,
    Address,
    AddressType,
    Cohort,
    Dataset,
    Device,
    Order,
    ReturnRequest,
    ScenarioId,
)
from app.engines import network_engine as ne
from app.engines.queue import run

TODAY = date(2026, 9, 13)
RING = set(RING_ACCOUNTS)
HOUSE = set(HOUSEHOLD_ACCOUNTS)


@pytest.fixture(scope="module")
def analyses():
    return {s: run(generate(s)) for s in ScenarioId}


def ring_cluster(a):
    for c in a.clusters:
        if set(c.account_ids) == RING:
            return c
    return None


def household_cluster(a):
    for c in a.clusters:
        if set(c.account_ids) == HOUSE:
            return c
    return None


# ==========================================================================
# Synthetic dataset builder for the adversarial cases
# ==========================================================================
def make_dataset(specs: list[dict], scenario=ScenarioId.NORMAL) -> Dataset:
    """specs: [{id, orders, returns, device, address, categories, claim_day, claim_type}]"""
    accounts, orders, returns = [], [], []
    devices, addresses = {}, {}
    oid, rid = 5000, 7000
    for spec in specs:
        aid = spec["id"]
        dev, addr = spec["device"], spec["address"]
        devices.setdefault(dev, Device(dev, "mobile"))
        addresses.setdefault(addr, Address(addr, AddressType.RESIDENTIAL, "Mumbai", "400001"))
        accounts.append(Account(aid, TODAY - timedelta(days=spec.get("age", 300)),
                                addr, [dev], Cohort.NORMAL))
        cats = spec.get("categories", ["Fashion"])
        acc_orders = []
        for i in range(spec["orders"]):
            oid += 1
            acc_orders.append(Order(f"ORD-{oid}", aid,
                                    TODAY - timedelta(days=200 - (i % 150)),
                                    cats[i % len(cats)], 1000.0 + 100 * (i % 9), dev))
        orders.extend(acc_orders)
        base_day = spec.get("claim_day", 30)
        for i in range(spec["returns"]):
            rid += 1
            returns.append(ReturnRequest(
                f"RET-{rid}", acc_orders[i].order_id, aid,
                spec.get("claim_type", "Changed mind"), 900.0,
                TODAY - timedelta(days=base_day + spec.get("claim_spread", 0) * i), 5))
    return Dataset(scenario=scenario, accounts=accounts, orders=orders, returns=returns,
                   devices=list(devices.values()), addresses=list(addresses.values()),
                   generated_on=TODAY)


# A right-skewed background population: many low-rate customers, few high-rate.
# The shape matters. An earlier version cycled through rates evenly and left a
# bump at 16%, which made the threshold engine's local trend fit slope UPWARDS
# and over-predict the window — so a genuine 6-account bunch scored zero. The
# distribution a test builds has to look like a real seller's, not a uniform
# sweep, or it tests nothing.
FILLER_SHAPE = [(2, 10), (4, 8), (6, 7), (8, 6), (10, 5), (12, 4), (14, 3), (16, 2)]
FILLER_ORDERS = 50   # every rate above lands exactly on its bin at 50 orders


def filler(scale: float = 1.0, start: int = 500) -> list[dict]:
    """Ordinary accounts, each with its own device and address, so they cannot cluster."""
    out, i = [], 0
    for rate_pct, count in FILLER_SHAPE:
        for _ in range(max(1, round(count * scale))):
            out.append({"id": f"ACC-{start+i}", "orders": FILLER_ORDERS,
                        "returns": round(FILLER_ORDERS * rate_pct / 100),
                        "device": f"DEV-F{i:03d}", "address": f"ADDR-F{i:03d}",
                        "categories": ["Fashion", "Beauty", "Home & Kitchen", "Accessories"],
                        "claim_day": 18 + i * 4, "claim_spread": 13})
            i += 1
    return out


# ==========================================================================
# TESTS 1-5 — the hero case
# ==========================================================================
def test_1_hero_group_is_discovered(analyses):
    c = ring_cluster(analyses[ScenarioId.COORDINATED])
    assert c is not None, "the five ring accounts were not found as one group"
    assert c.size == 5


def test_2_hero_group_has_multiple_relationship_types(analyses):
    c = ring_cluster(analyses[ScenarioId.COORDINATED])
    kinds = {e.code for e in c.evidence_items}
    assert {"shared_device", "shared_address"} <= kinds
    assert len(kinds) >= 4, kinds
    categories = {e.category for e in c.evidence_items}
    assert len(categories) >= 2, categories


def test_3_no_single_edge_connects_all_five(analyses):
    """Deliberate: a real ring is not linked end-to-end by one attribute."""
    a = analyses[ScenarioId.COORDINATED]
    c = ring_cluster(a)
    index = a.dataset.account_index()
    on_device = {x for x in c.account_ids if RING_DEVICE in index[x].device_ids}
    at_address = {x for x in c.account_ids if index[x].address_id == RING_ADDRESS}
    assert len(on_device) == 3 and len(at_address) == 3
    assert on_device != RING and at_address != RING
    for dev, members in c.shared_devices.items():
        assert len(members) < 5, dev
    for addr, members in c.shared_addresses.items():
        assert len(members) < 5, addr


def test_4_hero_accounts_remain_low_individually(analyses):
    a = analyses[ScenarioId.COORDINATED]
    for aid in RING_ACCOUNTS:
        assert a.individual[aid].band == "LOW", (aid, a.individual[aid].score)
        assert a.individual[aid].score < 30


def test_5_hero_cluster_reaches_high_coordination(analyses):
    a = analyses[ScenarioId.COORDINATED]
    c = ring_cluster(a)
    cc = a.coordination.clusters[c.cluster_id]
    assert cc.breakdown.band in ("HIGH", "VERY HIGH"), cc.breakdown.score
    assert cc.breakdown.score >= 60
    for aid in RING_ACCOUNTS:
        assert a.coordination.accounts[aid].band in ("HIGH", "VERY HIGH")


def test_5b_hero_is_the_top_cluster_by_a_clear_margin(analyses):
    a = analyses[ScenarioId.COORDINATED]
    c = ring_cluster(a)
    scores = sorted((cc.breakdown.score for cc in a.coordination.clusters.values()),
                    reverse=True)
    assert a.coordination.clusters[c.cluster_id].breakdown.score == scores[0]
    assert scores[0] > scores[1] + 30


# ==========================================================================
# TESTS 6-10 — counterexamples
# ==========================================================================
def test_6_normal_scenario_has_no_comparable_cluster(analyses):
    a = analyses[ScenarioId.NORMAL]
    top = max(cc.breakdown.score for cc in a.coordination.clusters.values())
    assert top < 30.0, top
    assert not [cc for cc in a.coordination.clusters.values()
                if cc.breakdown.band in ("HIGH", "VERY HIGH")]


def test_7_legitimate_household_stays_low(analyses):
    a = analyses[ScenarioId.HOUSEHOLD]
    c = household_cluster(a)
    assert c is not None, "the household should still be FOUND as a group"
    cc = a.coordination.clusters[c.cluster_id]
    assert cc.breakdown.band == "LOW", cc.breakdown.score
    assert cc.breakdown.score < 30


def test_7b_household_overlap_is_present_but_suppressed(analyses):
    """Network overlap PRESENT, coordination LOW — the required contrast."""
    a = analyses[ScenarioId.HOUSEHOLD]
    c = household_cluster(a)
    assert c.network_evidence >= 30.0, "shared address+device should be visible"
    assert c.shared_addresses and c.shared_devices
    assert c.benign_factor <= 0.35, c.benign_factor
    assert a.coordination.clusters[c.cluster_id].breakdown.band == "LOW"


# Accounts that share ONE attribute and differ in every other respect. An
# earlier version of these fixtures gave the group identical categories, claim
# types and return rates, so it was not testing "shared address alone" at all —
# category overlap, claim homogeneity and rate tightness alone reached 50/100.
VARIED_CATEGORIES = [
    ["Fashion", "Beauty"], ["Home & Kitchen", "Accessories"],
    ["Electronics", "Fashion", "Beauty"], ["Beauty", "Home & Kitchen"],
    ["Accessories", "Electronics", "Fashion"],
]
VARIED_CLAIMS = ["Changed mind", "Item not as described", "Wrong item",
                 "Changed mind", "Damaged item"]


def one_attribute_group(prefix: str, *, device=None, address=None, n: int = 5) -> list[dict]:
    """n accounts sharing exactly one attribute, differing in everything else."""
    return [
        {"id": f"ACC-{prefix}{i}", "orders": 50, "returns": i + 1,      # 2%..10%
         "device": device or f"DEV-{prefix}{i}",
         "address": address or f"ADDR-{prefix}{i}",
         "categories": VARIED_CATEGORIES[i % len(VARIED_CATEGORIES)],
         "claim_type": VARIED_CLAIMS[i % len(VARIED_CLAIMS)],
         "claim_day": 12 + i * 47, "claim_spread": 29, "age": 620}
        for i in range(n)
    ]


def test_8_shared_address_alone_is_not_high():
    """A shared address, with nothing else in common, is weak evidence.

    At 5 of 50 accounts the rarity-scaled address weight is 0.179, below the
    0.20 edge threshold, so no scored cluster forms — one moderate link is not
    an investigative group. The relationship stays VISIBLE in the entity graph,
    so an investigator looking at any of these accounts still sees it; it simply
    is not promoted into the queue on its own. Compare test_9: a shared DEVICE
    at 4 of 50 weighs 0.314, clears the bar, and does form a cluster — which is
    the intended ordering of relational strength.
    """
    specs = filler() + one_attribute_group("A", address="ADDR-SHARED", n=5)
    a = run(make_dataset(specs))
    group = {f"ACC-A{i}" for i in range(5)}

    for cc in a.coordination.clusters.values():
        assert cc.breakdown.band not in ("HIGH", "VERY HIGH"), cc.to_dict()

    # the relationship is still discoverable in the graph
    addr_edges = [e for e in a.graph.edges
                  if e.target == "ADDR-SHARED" and e.kind == "shared_address"]
    assert {e.source for e in addr_edges} == group
    assert all(e.weight < SETTINGS.edges.min_edge_weight for e in addr_edges)

    # and if it is clustered at all, it stays weak
    for c in a.clusters:
        if set(c.account_ids) & group:
            assert c.network_evidence < 45.0, c.components
            assert a.coordination.clusters[c.cluster_id].breakdown.band == "LOW"


def test_9_shared_device_alone_is_not_high():
    specs = filler() + one_attribute_group("D", device="DEV-SHARED", n=4)
    a = run(make_dataset(specs))
    for cc in a.coordination.clusters.values():
        assert cc.breakdown.band not in ("HIGH", "VERY HIGH"), cc.to_dict()
    group = {f"ACC-D{i}" for i in range(4)}
    found = [c for c in a.clusters if set(c.account_ids) == group]
    assert found, "the shared device should still form a visible group"
    c = found[0]
    assert c.components["link_strength"] > 0
    assert c.network_evidence < 45.0, c.components
    assert a.coordination.clusters[c.cluster_id].breakdown.band == "LOW"


def test_9b_one_component_cannot_exceed_its_weight():
    """Structural guarantee: no single network component weight exceeds 0.30."""
    np_ = SETTINGS.network
    weights = [np_.w_link_strength, np_.w_category_overlap, np_.w_claim_timing,
               np_.w_claim_homogeneity, np_.w_rate_tightness]
    assert max(weights) <= 0.30
    assert abs(sum(weights) - 1.0) < 1e-9


def test_10_isolated_abuser_is_not_forced_into_a_cluster(analyses):
    a = analyses[ScenarioId.ISOLATED]
    assert a.individual[ISOLATED_ACCOUNT].band in ("HIGH", "VERY HIGH")
    ac = a.coordination.accounts[ISOLATED_ACCOUNT]
    assert ac.band in ("LOW", "MODERATE"), ac.score
    assert ac.cluster_id is None or len(ac.related_accounts) == 0


# ==========================================================================
# TESTS 11-14 — evidence is computed, not asserted
# ==========================================================================
def test_11_temporal_similarity_comes_from_real_dates(analyses):
    a = analyses[ScenarioId.COORDINATED]
    c = ring_cluster(a)
    assert c.claim_window is not None
    lo, hi = c.claim_window
    assert (hi - lo).days <= 8
    filed = [r.filed_on for r in a.dataset.returns if r.account_id in RING]
    assert lo == min(filed) and hi == max(filed)
    assert c.temporal_overlap > 0.8

    far = ne.temporal_overlap([date(2026, 1, 1)], [date(2026, 6, 1)], 6)
    near = ne.temporal_overlap([date(2026, 1, 1)], [date(2026, 1, 3)], 6)
    assert far == 0.0 and near == 1.0


def test_12_product_overlap_comes_from_real_orders(analyses):
    a = analyses[ScenarioId.COORDINATED]
    c = ring_cluster(a)
    cats = {o.category for o in a.dataset.orders if o.account_id in RING}
    assert set(c.shared_categories) == cats == {"Electronics", "Small Appliances"}
    assert c.components["category_overlap"] == pytest.approx(1.0)


def test_13_threshold_signal_is_used_without_changing_individual_risk(analyses):
    a = analyses[ScenarioId.COORDINATED]
    from app.engines.features import build_features
    from app.engines.individual_risk import score_all
    f, ctx = build_features(generate(ScenarioId.COORDINATED))
    fresh = score_all(f, ctx)
    assert {k: v.score for k, v in fresh.items()} == {k: v.score for k, v in a.individual.items()}
    c = ring_cluster(a)
    assert a.coordination.clusters[c.cluster_id].breakdown.threshold > 0


def test_14_changing_the_threshold_changes_coordination():
    base = run(generate(ScenarioId.COORDINATED))
    moved = run(generate(ScenarioId.COORDINATED), threshold_value=0.25)
    b = base.coordination.clusters[ring_cluster(base).cluster_id].breakdown
    m = moved.coordination.clusters[ring_cluster(moved).cluster_id].breakdown
    assert m.threshold < b.threshold
    assert m.score < b.score
    # the network half is unaffected by where the seller draws its line
    assert m.network == pytest.approx(b.network)


# ==========================================================================
# TESTS 15-17 — robustness
# ==========================================================================
def test_15_sparse_relationships_are_safe():
    specs = filler(0.6)
    a = run(make_dataset(specs))
    assert all(cc.breakdown.band == "LOW" for cc in a.coordination.clusters.values())
    assert a.summary()["accounts"] == len(specs)


def test_16_empty_and_degenerate_graphs_do_not_crash():
    single = run(make_dataset([{"id": "ACC-9001", "orders": 6, "returns": 1,
                                "device": "DEV-1", "address": "ADDR-1"}]))
    assert single.clusters == []
    assert single.coordination.accounts["ACC-9001"].score >= 0.0
    assert single.queue

    no_returns = run(make_dataset([
        {"id": f"ACC-8{i:03d}", "orders": 8, "returns": 0,
         "device": f"DEV-8{i}", "address": f"ADDR-8{i}"} for i in range(6)]))
    assert no_returns.queue == []
    for cc in no_returns.coordination.clusters.values():
        assert 0.0 <= cc.breakdown.score <= 100.0


def test_17_results_are_deterministic():
    a = run(generate(ScenarioId.COORDINATED))
    b = run(generate(ScenarioId.COORDINATED))
    assert [c.to_dict() for c in a.clusters] == [c.to_dict() for c in b.clusters]
    assert a.coordination.to_dict() == b.coordination.to_dict()
    assert [r.to_dict() for r in a.queue] == [r.to_dict() for r in b.queue]


# ==========================================================================
# TESTS 18-20 — explainability and evidence breadth
# ==========================================================================
def test_18_explanations_contain_actual_evidence(analyses):
    a = analyses[ScenarioId.COORDINATED]
    c = ring_cluster(a)
    e = a.explain_cluster(c.cluster_id)
    text = " ".join(e.reasons)
    assert RING_DEVICE in text
    assert RING_ADDRESS in text
    assert "18.4%" in text and "19.1%" in text
    assert "20.0%" in text
    assert any(ch.isdigit() for ch in text)
    assert len(e.reasons) >= 5


def test_18b_explanations_never_assert_fraud(analyses):
    banned = ["fraud detected", "is fraudulent", "are fraudulent", "fraudster",
              "proves fraud", "confirmed fraud", "guilty", "reject refund"]
    for a in analyses.values():
        for cid in a.coordination.clusters:
            e = a.explain_cluster(cid)
            blob = (e.headline + " " + " ".join(e.reasons) + " " + e.closing).lower()
            for phrase in banned:
                assert phrase not in blob, (phrase, e.headline)


def test_18c_household_explanation_states_the_counter_evidence(analyses):
    a = analyses[ScenarioId.HOUSEHOLD]
    c = household_cluster(a)
    e = a.explain_cluster(c.cluster_id)
    assert "household" in (e.closing + " ".join(e.reasons)).lower()
    assert "do not indicate coordinated abuse" in e.closing.lower()


def test_18d_account_explanation_tells_the_cx0507_story(analyses):
    a = analyses[ScenarioId.COORDINATED]
    e = a.explain_account("ACC-1032")
    assert "individually low risk" in e.headline.lower()
    assert any("18.4%" in r for r in e.reasons)


def test_19_every_high_coordination_case_has_two_evidence_categories(analyses):
    for a in analyses.values():
        for cc in a.coordination.clusters.values():
            if cc.breakdown.band in ("HIGH", "VERY HIGH"):
                assert cc.independent_evidence_count >= 2, cc.to_dict()
                assert len(cc.evidence_categories) >= 2


def test_20_household_with_only_address_and_device_stays_low(analyses):
    a = analyses[ScenarioId.HOUSEHOLD]
    c = household_cluster(a)
    cc = a.coordination.clusters[c.cluster_id]
    assert c.shared_addresses and c.shared_devices
    assert c.temporal_overlap < 0.30
    assert cc.breakdown.band == "LOW"


# ==========================================================================
# Adversarial cases A-E
# ==========================================================================
def test_adv_a_distributed_activity_still_surfaces_as_a_group(analyses):
    """A: no account is individually high-risk, yet the group is prioritised."""
    a = analyses[ScenarioId.COORDINATED]
    c = ring_cluster(a)
    assert all(a.individual[x].band == "LOW" for x in c.account_ids)
    assert a.coordination.clusters[c.cluster_id].breakdown.band in ("HIGH", "VERY HIGH")
    assert a.coordination.clusters[c.cluster_id].investigation_priority in ("HIGH", "URGENT")


def test_adv_b_shared_device_only_legitimate():
    """B: a family sharing one tablet must not be prioritised."""
    specs = filler() + [
        {"id": f"ACC-B{i}", "orders": 22, "returns": 2, "device": "DEV-FAMILY",
         "address": f"ADDR-B{i}",
         "categories": ["Fashion", "Beauty", "Home & Kitchen", "Accessories", "Electronics"],
         "claim_day": 10 + i * 55, "claim_spread": 40, "age": 700}
        for i in range(4)]
    a = run(make_dataset(specs))
    for cc in a.coordination.clusters.values():
        assert cc.breakdown.band == "LOW", cc.to_dict()


def test_adv_c_shared_address_only_legitimate():
    """C: flatmates at one address must not be prioritised."""
    specs = filler() + [
        {"id": f"ACC-C{i}", "orders": 22, "returns": 2, "device": f"DEV-C{i}",
         "address": "ADDR-FLAT",
         "categories": ["Fashion", "Beauty", "Home & Kitchen", "Accessories", "Electronics"],
         "claim_day": 12 + i * 50, "claim_spread": 40, "age": 700}
        for i in range(5)]
    a = run(make_dataset(specs))
    for cc in a.coordination.clusters.values():
        assert cc.breakdown.band == "LOW", cc.to_dict()


def test_adv_d_bunching_without_network():
    """D: accounts bunch below the threshold but share nothing.

    The population signal may fire, but with no relational evidence no account
    should be labelled a coordinated group.
    """
    specs = filler() + [
        {"id": f"ACC-T{i}", "orders": 27, "returns": 5,           # 18.5%
         "device": f"DEV-T{i}", "address": f"ADDR-T{i}",
         "categories": ["Fashion", "Beauty"], "claim_day": 14 + i * 33, "claim_spread": 25}
        for i in range(6)]
    a = run(make_dataset(specs))
    assert a.threshold.bunching_score > 0, "population bunching should be visible"
    for cc in a.coordination.clusters.values():
        assert cc.breakdown.band not in ("HIGH", "VERY HIGH"), cc.to_dict()
    for aid in [f"ACC-T{i}" for i in range(6)]:
        assert a.coordination.accounts[aid].cluster_id is None
        assert a.coordination.accounts[aid].band in ("LOW", "MODERATE")


def test_adv_e_network_without_bunching():
    """E: a related group whose return rates are spread across the distribution.

    This is the complementarity test: network evidence must be able to surface a
    group even when the threshold signal is silent.
    """
    rates = [(30, 2), (30, 4), (30, 7), (30, 9), (30, 11)]   # 6.7% .. 36.7%
    specs = filler() + [
        {"id": f"ACC-N{i}", "orders": o, "returns": r, "device": "DEV-RING2",
         "address": "ADDR-RING2", "categories": ["Electronics"],
         "claim_day": 20, "claim_spread": 1, "age": 120}
        for i, (o, r) in enumerate(rates)]
    a = run(make_dataset(specs))
    group = {f"ACC-N{i}" for i in range(5)}
    found = [c for c in a.clusters if set(c.account_ids) == group]
    assert found, "the related group must still be discovered"
    c = found[0]
    assert c.network_evidence >= 40.0
    cc = a.coordination.clusters[c.cluster_id]
    assert cc.breakdown.threshold < 40.0, "threshold stream should be quiet here"
    assert cc.breakdown.network > cc.breakdown.threshold


# ==========================================================================
# Architectural cases A-D
# ==========================================================================
def test_case_a_high_individual_weak_network_is_isolated_abuse(analyses):
    a = analyses[ScenarioId.ISOLATED]
    ind = a.individual[ISOLATED_ACCOUNT]
    ac = a.coordination.accounts[ISOLATED_ACCOUNT]
    assert ind.band in ("HIGH", "VERY HIGH") and ac.band in ("LOW", "MODERATE")
    top = [r for r in a.queue if r.account_id == ISOLATED_ACCOUNT]
    assert top and min(r.rank for r in top) <= 25, "should still reach the queue"


def test_case_b_low_individual_high_threshold_high_network(analyses):
    a = analyses[ScenarioId.COORDINATED]
    c = ring_cluster(a)
    b = a.coordination.clusters[c.cluster_id].breakdown
    assert b.individual < 30 and b.threshold >= 60 and b.network >= 60
    assert b.band in ("HIGH", "VERY HIGH")


def test_case_c_household_pattern(analyses):
    a = analyses[ScenarioId.HOUSEHOLD]
    b = a.coordination.clusters[household_cluster(a).cluster_id].breakdown
    assert b.threshold < 30 and b.benign_factor <= 0.35 and b.band == "LOW"


def test_individual_stream_alone_cannot_reach_high():
    """Structural: individual risk is weighted 0.15, so 100/100 yields 15."""
    from app.engines.coordination_engine import _combine
    assert _combine(100.0, 0.0, 0.0, 1.0).score <= 15.0 + 1e-9
    assert _combine(100.0, 0.0, 0.0, 1.0).band == "LOW"


# ==========================================================================
# Queue
# ==========================================================================
def test_queue_is_ordered_and_actionable(analyses):
    a = analyses[ScenarioId.COORDINATED]
    scores = [r.priority_score for r in a.queue]
    assert scores == sorted(scores, reverse=True)
    assert [r.rank for r in a.queue] == list(range(1, len(a.queue) + 1))
    for r in a.queue[:20]:
        assert r.primary_reasons
        assert r.status == "Awaiting review"
        d = r.to_dict()
        assert d["recommended_action"] == "PRIORITISE FOR REVIEW"
        assert "Reject" not in " ".join(d["available_actions"])


def test_queue_surfaces_the_ring(analyses):
    a = analyses[ScenarioId.COORDINATED]
    top20 = {r.account_id for r in a.queue[:20]}
    assert len(RING & top20) >= 4, top20


def test_no_row_recommends_automatic_denial(analyses):
    for a in analyses.values():
        for r in a.queue:
            assert "deny" not in r.to_dict()["recommended_action"].lower()


# ==========================================================================
# API contract
# ==========================================================================
@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def test_api_endpoints_respond(client):
    for url in ["/api/health", "/api/scenarios", "/api/summary?scenario=coordinated",
                "/api/accounts?scenario=normal", "/api/returns?scenario=coordinated",
                "/api/threshold-analysis?scenario=coordinated",
                "/api/clusters?scenario=coordinated",
                "/api/network/ACC-1032", "/api/coordination/ACC-1032",
                "/api/explanations/ACC-1032", "/api/investigation-queue",
                "/api/demo/hero"]:
        assert client.get(url).status_code == 200, url


def test_api_phase3_contract_is_unbroken(client):
    d = client.get("/api/threshold-analysis?scenario=coordinated").json()
    for key in ("threshold", "window", "eligible_accounts", "observed_count",
                "expected_count", "excess_count", "bunching_score", "signal_band",
                "explanation", "caveat", "bins", "account_signals", "p_value"):
        assert key in d, key
    assert d["observed_count"] == 6
    assert d["signal_band"] == "VERY HIGH"


def test_api_demo_hero_is_the_ring(client):
    d = client.get("/api/demo/hero").json()
    assert set(d["cluster"]["account_ids"]) == RING
    assert d["cluster"]["coordination"]["band"] in ("HIGH", "VERY HIGH")
    assert d["cluster"]["coordination"]["recommended_action"] == "PRIORITISE FOR REVIEW"
    assert len(d["members"]) == 5
    assert {m["individual_band"] for m in d["members"]} == {"LOW"}


def test_api_unknown_ids_are_404(client):
    assert client.get("/api/network/ACC-0000").status_code == 404
    assert client.get("/api/clusters/C-999?scenario=normal").status_code == 404
    assert client.get("/api/summary?scenario=nope").status_code == 404


def test_api_carries_the_synthetic_notice(client):
    d = client.get("/api/summary?scenario=coordinated").json()
    assert "no real customer data" in d["synthetic_notice"].lower()


def test_api_network_filter(client):
    all_e = client.get("/api/network/ACC-1032").json()
    dev = client.get("/api/network/ACC-1032?relationship=shared_device").json()
    assert len(dev["edges"]) <= len(all_e["edges"])
    assert {e["kind"] for e in dev["edges"]} <= {"shared_device"}
    assert "Connections provide context" in all_e["caveat"]
