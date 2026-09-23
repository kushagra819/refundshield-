"""RefundShield — relationship graph and network evidence (Phase 4).

Builds a relationship graph from the seller's existing records, finds connected
groups of accounts, and describes WHY each group is connected.

WHY NO SINGLE ATTRIBUTE CAN CARRY A CASE
----------------------------------------
Network evidence is a weighted sum of five components whose weights sum to 1.0
and none of which exceeds 0.30. A cluster whose members share a device and
nothing else therefore cannot score above 30/100 no matter how strong that one
link is. That is arithmetic, not tuning — "shared device does not prove fraud"
is enforced by the shape of the formula.

TWO CLASSES OF EDGE
-------------------
  structural     shared device, shared address — can create a cluster
  corroborating  category overlap, claim timing, behavioural similarity —
                 only add weight to a pair, unless at least two of them are
                 independently strong

Without that split, "both accounts bought Electronics" would wire most of the
customer base into one useless blob.

INVERSE-FREQUENCY WEIGHTING
---------------------------
Every structural link is scaled by how rare the shared entity is. A device on
3 of 100 accounts is strong evidence; an address on 40 of 100 is an office or a
parcel locker and is weak evidence. Without this the largest shared entities —
the most innocent ones — would dominate every cluster.

Nothing here is a trained model and no component is a fraud probability.
"""
from __future__ import annotations

import math
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from itertools import combinations
from typing import Any

import networkx as nx

from ..config import SCORING_NOTICE, SETTINGS, band_for, evidence_strength
from ..domain.models import Dataset
from .features import AccountFeatures

RATE_TOLERANCE = 0.05          # return rates within 5pp count as "similar"
MIN_CLAIMS_FOR_TIMING = 1
CATEGORY_OVERLAP_MIN = 0.50    # Jaccard below this is not corroborating evidence
BEHAVIOURAL_MIN = 0.60
MAX_CLUSTER_SIZE = 12          # above this a component is split (see find_clusters)


# ==========================================================================
# Graph structures
# ==========================================================================
@dataclass
class GraphNode:
    id: str
    kind: str          # account | device | address | category
    label: str
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "label": self.label, "meta": self.meta}


@dataclass
class GraphEdge:
    source: str
    target: str
    kind: str          # shared_device | shared_address | category_overlap | claim_timing | behavioural
    label: str
    weight: float
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source, "target": self.target, "kind": self.kind,
            "label": self.label, "weight": round(self.weight, 3), "detail": self.detail,
        }


@dataclass
class RelationshipGraph:
    nodes: list[GraphNode]
    edges: list[GraphEdge]                       # entity graph, for visualisation
    account_links: list[GraphEdge]               # account<->account projection
    entity_rarity: dict[str, float]

    def to_dict(self) -> dict[str, Any]:
        return {
            "nodes": [n.to_dict() for n in self.nodes],
            "edges": [e.to_dict() for e in self.edges],
            "account_links": [e.to_dict() for e in self.account_links],
        }


@dataclass
class EvidenceItem:
    code: str
    category: str      # relational | behavioural | temporal | population
    label: str
    strength: str      # LOW | MODERATE | HIGH
    detail: str
    value: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code, "category": self.category, "label": self.label,
            "strength": self.strength, "detail": self.detail, "value": round(self.value, 3),
        }


@dataclass
class Cluster:
    cluster_id: str
    account_ids: list[str]
    network_evidence: float            # 0-100
    network_band: str
    components: dict[str, float]       # normalised 0-1 component scores
    benign_factor: float
    benign_indicators: dict[str, float]
    shared_devices: dict[str, list[str]]
    shared_addresses: dict[str, list[str]]
    shared_categories: list[str]
    temporal_overlap: float
    behavioural_similarity: float
    claim_window: tuple[date, date] | None
    return_rate_range: tuple[float, float]
    evidence_items: list[EvidenceItem] = field(default_factory=list)
    notice: str = SCORING_NOTICE

    @property
    def size(self) -> int:
        return len(self.account_ids)

    def to_dict(self) -> dict[str, Any]:
        return {
            "cluster_id": self.cluster_id,
            "account_ids": self.account_ids,
            "size": self.size,
            "network_evidence": round(self.network_evidence, 1),
            "network_band": self.network_band,
            "components": {k: round(v, 3) for k, v in self.components.items()},
            "benign_factor": round(self.benign_factor, 3),
            "benign_indicators": {k: round(v, 3) for k, v in self.benign_indicators.items()},
            "shared_devices": self.shared_devices,
            "shared_addresses": self.shared_addresses,
            "shared_categories": self.shared_categories,
            "temporal_overlap": round(self.temporal_overlap, 3),
            "behavioural_similarity": round(self.behavioural_similarity, 3),
            "claim_window": ([self.claim_window[0].isoformat(),
                              self.claim_window[1].isoformat()]
                             if self.claim_window else None),
            "return_rate_range": [round(self.return_rate_range[0] * 100, 1),
                                  round(self.return_rate_range[1] * 100, 1)],
            "evidence_items": [e.to_dict() for e in self.evidence_items],
            "notice": self.notice,
        }


# ==========================================================================
# Pairwise similarity helpers
# ==========================================================================
def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _claim_mix_cosine(a: dict[str, int], b: dict[str, int]) -> float:
    keys = set(a) | set(b)
    if not keys:
        return 0.0
    va = [a.get(k, 0) for k in keys]
    vb = [b.get(k, 0) for k in keys]
    na = math.sqrt(sum(x * x for x in va))
    nb = math.sqrt(sum(x * x for x in vb))
    if na == 0 or nb == 0:
        return 0.0
    return sum(x * y for x, y in zip(va, vb)) / (na * nb)


def temporal_overlap(dates_a: list[date], dates_b: list[date], window_days: int) -> float:
    """Share of two accounts' claims that fall within `window_days` of each other.

    Computed from the actual filing dates, not from any cohort label.
    """
    if len(dates_a) < MIN_CLAIMS_FOR_TIMING or len(dates_b) < MIN_CLAIMS_FOR_TIMING:
        return 0.0
    matched_a = sum(1 for d in dates_a if any(abs((d - e).days) <= window_days for e in dates_b))
    matched_b = sum(1 for d in dates_b if any(abs((d - e).days) <= window_days for e in dates_a))
    return (matched_a + matched_b) / (len(dates_a) + len(dates_b))


def behavioural_similarity(fa: AccountFeatures, fb: AccountFeatures) -> float:
    """Transparent similarity: rate closeness, claim-mix cosine, high-value closeness.

    Deliberately three readable terms rather than an embedding, so an
    investigator can be told exactly which one drove the number.
    """
    rate_close = max(0.0, 1.0 - abs(fa.return_rate - fb.return_rate) / RATE_TOLERANCE)
    mix = _claim_mix_cosine(fa.claim_type_counts, fb.claim_type_counts)
    hv_close = max(0.0, 1.0 - abs(fa.high_value_return_share - fb.high_value_return_share))
    return (rate_close + mix + hv_close) / 3.0


# ==========================================================================
# Graph construction
# ==========================================================================
def build_graph(ds: Dataset, features: dict[str, AccountFeatures]) -> RelationshipGraph:
    ew = SETTINGS.edges
    n_accounts = max(1, len(ds.accounts))

    device_members: dict[str, list[str]] = defaultdict(list)
    address_members: dict[str, list[str]] = defaultdict(list)
    for acc in ds.accounts:
        for dev in acc.device_ids:
            device_members[dev].append(acc.account_id)
        address_members[acc.address_id].append(acc.account_id)

    def rarity(n_sharing: int) -> float:
        """Inverse-frequency weight in [0, 1]. Rare entity -> close to 1."""
        if n_sharing <= 1:
            return 0.0
        return max(0.0, min(1.0, math.log(n_accounts / n_sharing) / math.log(n_accounts / 2)))

    entity_rarity: dict[str, float] = {}
    for dev, members in device_members.items():
        entity_rarity[dev] = rarity(len(members))
    for addr, members in address_members.items():
        entity_rarity[addr] = rarity(len(members))

    # ---- nodes ----------------------------------------------------------
    nodes: list[GraphNode] = []
    for acc in ds.accounts:
        f = features.get(acc.account_id)
        nodes.append(GraphNode(
            acc.account_id, "account", acc.account_id,
            {"return_rate_pct": round((f.return_rate if f else 0.0) * 100, 1),
             "orders": f.order_count if f else 0,
             "returns": f.return_count if f else 0},
        ))
    for dev, members in device_members.items():
        if len(members) > 1:
            nodes.append(GraphNode(dev, "device", dev,
                                   {"accounts": len(members),
                                    "rarity": round(entity_rarity[dev], 3)}))
    for addr, members in address_members.items():
        if len(members) > 1:
            nodes.append(GraphNode(addr, "address", addr,
                                   {"accounts": len(members),
                                    "rarity": round(entity_rarity[addr], 3)}))

    # ---- entity edges (for the visualisation) ---------------------------
    edges: list[GraphEdge] = []
    for dev, members in device_members.items():
        if len(members) > 1:
            for aid in members:
                edges.append(GraphEdge(aid, dev, "shared_device", "Shared device",
                                       ew.shared_device * entity_rarity[dev],
                                       f"{dev} is used by {len(members)} accounts."))
    for addr, members in address_members.items():
        if len(members) > 1:
            for aid in members:
                edges.append(GraphEdge(aid, addr, "shared_address", "Common address",
                                       ew.shared_address * entity_rarity[addr],
                                       f"{addr} is used by {len(members)} accounts."))

    # ---- account <-> account projection ---------------------------------
    returns_by_acct: dict[str, list[date]] = defaultdict(list)
    for r in ds.returns:
        returns_by_acct[r.account_id].append(r.filed_on)

    structural: dict[tuple[str, str], list[GraphEdge]] = defaultdict(list)
    for dev, members in device_members.items():
        if len(members) > 1 and entity_rarity[dev] > 0:
            for a, b in combinations(sorted(members), 2):
                structural[(a, b)].append(GraphEdge(
                    a, b, "shared_device", "Shared device",
                    ew.shared_device * entity_rarity[dev],
                    f"Both accounts use {dev}, shared by {len(members)} accounts.",
                ))
    for addr, members in address_members.items():
        if len(members) > 1 and entity_rarity[addr] > 0:
            for a, b in combinations(sorted(members), 2):
                structural[(a, b)].append(GraphEdge(
                    a, b, "shared_address", "Common address",
                    ew.shared_address * entity_rarity[addr],
                    f"Both accounts deliver to {addr}, shared by {len(members)} accounts.",
                ))

    # corroborating signals are only computed for pairs that are already
    # structurally linked, or that are active in the same period — otherwise
    # this is a pointless O(n^2) sweep over the whole customer base
    active = [aid for aid, d in returns_by_acct.items() if d]
    candidate_pairs: set[tuple[str, str]] = set(structural)
    for a, b in combinations(sorted(active), 2):
        da, db = returns_by_acct[a], returns_by_acct[b]
        if abs((max(da) - max(db)).days) <= SETTINGS.network.timing_window_days * 2:
            candidate_pairs.add((a, b))

    account_links: list[GraphEdge] = []
    for a, b in sorted(candidate_pairs):
        fa, fb = features.get(a), features.get(b)
        if fa is None or fb is None:
            continue
        found = list(structural.get((a, b), []))
        corroborating: list[GraphEdge] = []

        cat = _jaccard(set(fa.categories), set(fb.categories))
        if cat >= CATEGORY_OVERLAP_MIN:
            corroborating.append(GraphEdge(
                a, b, "category_overlap", "Product overlap",
                ew.category_overlap * cat,
                f"{len(set(fa.categories) & set(fb.categories))} shared product "
                f"categories (Jaccard {cat:.2f}).",
            ))
        tmp = temporal_overlap(returns_by_acct[a], returns_by_acct[b],
                               SETTINGS.network.timing_window_days)
        if tmp > 0:
            corroborating.append(GraphEdge(
                a, b, "claim_timing", "Similar claim timing",
                ew.claim_timing * tmp,
                f"{tmp * 100:.0f}% of both accounts' claims fall within "
                f"{SETTINGS.network.timing_window_days} days of each other.",
            ))
        beh = behavioural_similarity(fa, fb)
        if beh >= BEHAVIOURAL_MIN:
            corroborating.append(GraphEdge(
                a, b, "behavioural", "Behavioural similarity",
                ew.behavioural_similarity * beh,
                f"Return rates {fa.return_rate * 100:.1f}% vs {fb.return_rate * 100:.1f}%, "
                f"similar claim mix and high-value pattern (similarity {beh:.2f}).",
            ))

        total = sum(e.weight for e in found) + sum(e.weight for e in corroborating)
        if found:
            # structurally linked: corroborating signals just add weight
            keep = total >= ew.min_edge_weight
        else:
            # No shared entity. Corroborating signals may still link a pair, but
            # the bar is deliberately near-maximal on ALL THREE. An earlier
            # version accepted "two reasonably strong" signals and chained 93 of
            # 100 accounts into a single useless component, because plenty of
            # honest customers buy the same categories and behave alike.
            base = {"category_overlap": ew.category_overlap,
                    "claim_timing": ew.claim_timing,
                    "behavioural": ew.behavioural_similarity}
            near_max = [e for e in corroborating
                        if e.weight >= ew.corroborating_strong_at * base[e.kind]]
            keep = (len(corroborating) == 3 and len(near_max) == 3
                    and total >= ew.corroborating_only_min)
        if keep:
            account_links.extend(found + corroborating)

    return RelationshipGraph(nodes=nodes, edges=edges,
                             account_links=account_links, entity_rarity=entity_rarity)


# ==========================================================================
# Clustering + cluster evidence
# ==========================================================================
def _pair_weight_map(links: list[GraphEdge]) -> dict[tuple[str, str], float]:
    out: dict[tuple[str, str], float] = defaultdict(float)
    for e in links:
        out[tuple(sorted((e.source, e.target)))] += e.weight
    return dict(out)


def find_clusters(graph: RelationshipGraph) -> list[list[str]]:
    """Connected components, with oversized components split by modularity.

    Connected components alone are not enough at this scale. With 74 devices
    across 100 accounts, accidental device and address collisions are guaranteed
    by the pigeonhole principle, and those weak links chain 90+ ordinary
    accounts into one component. A 93-account "cluster" is not an investigative
    unit — an investigator cannot act on it, and it drowns the real groups.

    So any component larger than MAX_CLUSTER_SIZE is split with weighted greedy
    modularity, which keeps densely-linked groups together and cuts the weak
    chaining links. Small components are left exactly as they are, so a genuine
    five-account group is never reshaped.

    Deliberately interpretable: no GNN, no embedding. An investigator can always
    be shown which links hold a group together.
    """
    g = nx.Graph()
    for (a, b), w in sorted(_pair_weight_map(graph.account_links).items()):
        if w >= SETTINGS.edges.min_edge_weight:
            g.add_edge(a, b, weight=w)

    out: list[list[str]] = []
    for comp in nx.connected_components(g):
        members = sorted(comp)
        if len(members) <= MAX_CLUSTER_SIZE:
            if len(members) >= SETTINGS.network.min_cluster_size:
                out.append(members)
            continue
        sub = g.subgraph(members)
        try:
            communities = nx.community.greedy_modularity_communities(sub, weight="weight")
        except Exception:
            communities = [set(members)]
        for c in communities:
            group = sorted(c)
            if len(group) >= SETTINGS.network.min_cluster_size:
                out.append(group)
    return out


def _benign_factor(members: list[AccountFeatures], claim_span_days: float) -> tuple[float, dict[str, float]]:
    """How strongly this cluster looks like an ordinary household rather than a ring.

    Suppression is the MINIMUM of the indicators: a group must look ordinary on
    EVERY axis to be treated as benign. Averaging would let a ring that happens
    to buy broadly hide behind that single ordinary-looking trait.
    """
    bp = SETTINGS.benign
    avg_categories = statistics.fmean([len(m.categories) for m in members]) if members else 0.0
    shared_lifespan = min((m.account_age_days for m in members), default=0)

    breadth = min(1.0, avg_categories / bp.broad_categories_per_member)
    lifespan = min(1.0, shared_lifespan / bp.long_shared_lifespan_days)
    dispersion = min(1.0, claim_span_days / bp.dispersed_timing_days)

    suppression = min(breadth, lifespan, dispersion)
    factor = max(bp.min_factor, min(bp.max_factor, 1.0 - suppression))
    return factor, {
        "category_breadth": breadth,
        "shared_lifespan": lifespan,
        "timing_dispersion": dispersion,
        "suppression": suppression,
        "avg_categories_per_member": avg_categories,
        "shared_lifespan_days": float(shared_lifespan),
        "claim_span_days": float(claim_span_days),
    }


def analyse_cluster(cluster_id: str, account_ids: list[str], ds: Dataset,
                    features: dict[str, AccountFeatures],
                    graph: RelationshipGraph) -> Cluster:
    np_ = SETTINGS.network
    members = [features[a] for a in account_ids if a in features]
    member_set = set(account_ids)

    # shared entities actually held in common by >1 member of THIS cluster
    dev_map: dict[str, list[str]] = defaultdict(list)
    addr_map: dict[str, list[str]] = defaultdict(list)
    index = ds.account_index()
    for aid in account_ids:
        acc = index.get(aid)
        if acc is None:
            continue
        for d in acc.device_ids:
            dev_map[d].append(aid)
        addr_map[acc.address_id].append(aid)
    shared_devices = {d: sorted(m) for d, m in dev_map.items() if len(m) > 1}
    shared_addresses = {a: sorted(m) for a, m in addr_map.items() if len(m) > 1}

    # ---- components (each normalised to 0-1) -----------------------------
    pair_w = _pair_weight_map([e for e in graph.account_links
                               if e.source in member_set and e.target in member_set])
    n_pairs = max(1, len(account_ids) * (len(account_ids) - 1) // 2)
    struct_w = sum(
        w for (a, b), w in _pair_weight_map(
            [e for e in graph.account_links
             if e.kind in ("shared_device", "shared_address")
             and e.source in member_set and e.target in member_set]).items()
    )
    link_strength = min(1.0, struct_w / (n_pairs * SETTINGS.edges.shared_device))

    cats = [set(m.categories) for m in members if m.categories]
    category_overlap = (statistics.fmean([_jaccard(a, b) for a, b in combinations(cats, 2)])
                        if len(cats) > 1 else 0.0)

    ret_dates: dict[str, list[date]] = defaultdict(list)
    for r in ds.returns:
        if r.account_id in member_set:
            ret_dates[r.account_id].append(r.filed_on)
    pairs = [(a, b) for a, b in combinations(sorted(ret_dates), 2)]
    temporal = (statistics.fmean([temporal_overlap(ret_dates[a], ret_dates[b],
                                                   np_.timing_window_days)
                                  for a, b in pairs]) if pairs else 0.0)

    claim_types = Counter(r.claim_type for r in ds.returns if r.account_id in member_set)
    total_claims = sum(claim_types.values())
    claim_homogeneity = (max(claim_types.values()) / total_claims) if total_claims else 0.0

    rates = [m.return_rate for m in members]
    if len(rates) > 1 and statistics.fmean(rates) > 0:
        spread = statistics.pstdev(rates) / statistics.fmean(rates)
        rate_tightness = max(0.0, 1.0 - min(1.0, spread / 0.35))
    else:
        rate_tightness = 0.0

    behav = (statistics.fmean([behavioural_similarity(features[a], features[b])
                               for a, b in combinations(account_ids, 2)
                               if a in features and b in features])
             if len(account_ids) > 1 else 0.0)

    components = {
        "link_strength": link_strength,
        "category_overlap": category_overlap,
        "claim_timing": temporal,
        "claim_homogeneity": claim_homogeneity,
        "rate_tightness": rate_tightness,
    }
    score = 100.0 * (
        np_.w_link_strength * link_strength
        + np_.w_category_overlap * category_overlap
        + np_.w_claim_timing * temporal
        + np_.w_claim_homogeneity * claim_homogeneity
        + np_.w_rate_tightness * rate_tightness
    )
    score = max(0.0, min(100.0, score))

    all_dates = [d for ds_ in ret_dates.values() for d in ds_]
    window = (min(all_dates), max(all_dates)) if all_dates else None
    span = (window[1] - window[0]).days if window else 0.0
    benign_factor, benign_indicators = _benign_factor(members, span)

    shared_cats = sorted(set.intersection(*cats)) if cats and len(cats) > 1 else (
        sorted(cats[0]) if cats else [])

    # ---- evidence items (actual values, never templated text) ------------
    items: list[EvidenceItem] = []
    for dev, m in shared_devices.items():
        r = graph.entity_rarity.get(dev, 0.0)
        items.append(EvidenceItem(
            "shared_device", "relational", "Shared device",
            evidence_strength(r), f"{len(m)} accounts use {dev}: {', '.join(m)}.", r))
    for addr, m in shared_addresses.items():
        r = graph.entity_rarity.get(addr, 0.0)
        items.append(EvidenceItem(
            "shared_address", "relational", "Common address",
            evidence_strength(r * 0.8),
            f"{len(m)} accounts deliver to {addr}: {', '.join(m)}.", r))
    if category_overlap > 0:
        items.append(EvidenceItem(
            "product_overlap", "behavioural", "Product overlap",
            evidence_strength(category_overlap),
            f"Members overlap on product categories "
            f"({', '.join(shared_cats) or 'none in common'}); "
            f"mean pairwise overlap {category_overlap:.2f}.", category_overlap))
    if temporal > 0 and window:
        items.append(EvidenceItem(
            "claim_timing", "temporal", "Similar claim timing",
            evidence_strength(temporal),
            f"Claims fall between {window[0].isoformat()} and {window[1].isoformat()} "
            f"({span} days); mean pairwise overlap {temporal:.2f}.", temporal))
    if rate_tightness > 0:
        items.append(EvidenceItem(
            "rate_tightness", "behavioural", "Return rates cluster together",
            evidence_strength(rate_tightness),
            f"Member return rates span {min(rates) * 100:.1f}%-{max(rates) * 100:.1f}%.",
            rate_tightness))
    if behav > 0:
        items.append(EvidenceItem(
            "behavioural_similarity", "behavioural", "Behavioural similarity",
            evidence_strength(behav),
            f"Mean pairwise behavioural similarity {behav:.2f} across "
            f"{len(account_ids)} accounts.", behav))

    return Cluster(
        cluster_id=cluster_id, account_ids=account_ids,
        network_evidence=score, network_band=band_for(score), components=components,
        benign_factor=benign_factor, benign_indicators=benign_indicators,
        shared_devices=shared_devices, shared_addresses=shared_addresses,
        shared_categories=shared_cats, temporal_overlap=temporal,
        behavioural_similarity=behav, claim_window=window,
        return_rate_range=(min(rates) if rates else 0.0, max(rates) if rates else 0.0),
        evidence_items=items,
    )


def analyse(ds: Dataset, features: dict[str, AccountFeatures]
            ) -> tuple[RelationshipGraph, list[Cluster]]:
    graph = build_graph(ds, features)
    groups = find_clusters(graph)
    groups.sort(key=lambda g: (-len(g), g[0]))
    clusters = [analyse_cluster(f"C-{i + 1:03d}", g, ds, features, graph)
                for i, g in enumerate(groups)]
    return graph, clusters
