"""RefundShield — coordination risk (Phase 4).

Combines the three independent evidence streams into one prioritisation score:

    individual risk   (Phase 2, per account)
    threshold signal  (Phase 3, population-level)
    network evidence  (Phase 4, cluster-level)

WHY INDIVIDUAL RISK CARRIES ONLY 0.15
-------------------------------------
CX0507's premise is that each ring account looks acceptable alone. If individual
risk could drive coordination risk, the system would simply rediscover the
threshold rule it exists to replace. At weight 0.15 the individual stream can
contribute at most 15 of 100 points, so it can never reach HIGH on its own — it
is context, not a driver. The isolated abuser (individual 79.9, no cluster, no
bunching) therefore lands at LOW coordination risk, which is correct: that
account is an individual problem, not a coordinated one.

WHY THE THRESHOLD INPUT IS A CLUSTER PROPERTY
---------------------------------------------
Bunching is a property of a population, not of a person. A cluster member's
threshold input is therefore the population signal scaled by how much of the
cluster actually sits in the bunching window, not that one account's distance
from the line.

THIS IS NOT A FRAUD PROBABILITY. It is a triage score over synthetic data.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Any

from ..config import (
    CLAIM_SEVERITY,
    SCORING_NOTICE,
    SETTINGS,
    band_for,
    priority_for,
)
from ..domain.models import Dataset
from .features import AccountFeatures
from .individual_risk import IndividualRisk
from .network_engine import Cluster
from .threshold_engine import ThresholdEvasionResult

NO_CLUSTER_THRESHOLD_CREDIT = 0.40   # an unclustered account gets only partial credit
IN_WINDOW_FLOOR = 0.40               # cluster threshold credit when nobody is in-window

RECOMMENDED_ACTION = "PRIORITISE FOR REVIEW"
ACTION_NOTE = ("RefundShield prioritises cases for investigation. "
               "It does not automatically deny refunds.")


@dataclass
class CoordinationBreakdown:
    individual: float
    threshold: float
    network: float
    benign_factor: float
    raw: float
    score: float
    band: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "individual_risk_context": round(self.individual, 1),
            "threshold_evasion_signal": round(self.threshold, 1),
            "network_evidence": round(self.network, 1),
            "benign_factor": round(self.benign_factor, 3),
            "raw_before_benign": round(self.raw, 1),
            "coordination_risk": round(self.score, 1),
            "band": self.band,
            "weights": {
                "network": SETTINGS.coordination.network,
                "threshold": SETTINGS.coordination.threshold,
                "individual": SETTINGS.coordination.individual,
            },
            "notice": "Prototype coordination score — not a fraud probability.",
        }


@dataclass
class AccountCoordination:
    account_id: str
    cluster_id: str | None
    related_accounts: list[str]
    breakdown: CoordinationBreakdown
    evidence_categories: list[str]
    notice: str = SCORING_NOTICE

    @property
    def score(self) -> float:
        return self.breakdown.score

    @property
    def band(self) -> str:
        return self.breakdown.band

    def to_dict(self) -> dict[str, Any]:
        return {
            "account_id": self.account_id,
            "cluster_id": self.cluster_id,
            "related_accounts": self.related_accounts,
            "related_account_count": len(self.related_accounts),
            "coordination_risk": round(self.breakdown.score, 1),
            "band": self.breakdown.band,
            "breakdown": self.breakdown.to_dict(),
            "evidence_categories": self.evidence_categories,
            "notice": self.notice,
        }


@dataclass
class ClusterCoordination:
    cluster_id: str
    account_ids: list[str]
    breakdown: CoordinationBreakdown
    in_window_share: float
    evidence_categories: list[str]
    independent_evidence_count: int
    investigation_priority: str
    recommended_action: str = RECOMMENDED_ACTION
    action_note: str = ACTION_NOTE

    def to_dict(self) -> dict[str, Any]:
        return {
            "cluster_id": self.cluster_id,
            "account_ids": self.account_ids,
            "size": len(self.account_ids),
            "coordination_risk": round(self.breakdown.score, 1),
            "band": self.breakdown.band,
            "breakdown": self.breakdown.to_dict(),
            "in_window_share": round(self.in_window_share, 3),
            "evidence_categories": self.evidence_categories,
            "independent_evidence_count": self.independent_evidence_count,
            "investigation_priority": self.investigation_priority,
            "recommended_action": self.recommended_action,
            "action_note": self.action_note,
        }


@dataclass
class CoordinationResult:
    clusters: dict[str, ClusterCoordination]
    accounts: dict[str, AccountCoordination]
    cluster_index: dict[str, str]          # account_id -> cluster_id

    def to_dict(self) -> dict[str, Any]:
        return {
            "clusters": {k: v.to_dict() for k, v in self.clusters.items()},
            "accounts": {k: v.to_dict() for k, v in self.accounts.items()},
        }


def _cluster_threshold_input(cluster: Cluster, threshold: ThresholdEvasionResult) -> tuple[float, float]:
    """Population bunching, scaled by how much of this cluster sits in the window."""
    members = cluster.account_ids
    in_window = sum(1 for a in members
                    if a in threshold.account_signals and threshold.account_signals[a].in_window)
    share = in_window / max(1, len(members))
    scaled = threshold.bunching_score * (IN_WINDOW_FLOOR + (1 - IN_WINDOW_FLOOR) * share)
    return scaled, share


def _combine(individual: float, threshold: float, network: float,
             benign: float) -> CoordinationBreakdown:
    w = SETTINGS.coordination
    raw = w.network * network + w.threshold * threshold + w.individual * individual
    score = max(0.0, min(100.0, raw * benign))
    return CoordinationBreakdown(individual=individual, threshold=threshold,
                                 network=network, benign_factor=benign,
                                 raw=raw, score=score, band=band_for(score))


def _priority_score(coordination: float, individual: float,
                    independent_evidence: int, related: int) -> float:
    """Where should limited review time go first?

    Coordination dominates, individual risk is a real secondary route (so an
    isolated abuser still reaches the queue), and breadth of evidence and group
    size add a modest amount. No single term can carry the score alone.
    """
    evidence_bonus = min(10.0, 3.0 * max(0, independent_evidence - 1))
    size_bonus = min(6.0, 1.5 * max(0, related))
    return max(0.0, min(100.0,
                        0.60 * coordination + 0.30 * individual
                        + evidence_bonus + size_bonus))


def analyse(ds: Dataset,
            features: dict[str, AccountFeatures],
            individual: dict[str, IndividualRisk],
            threshold: ThresholdEvasionResult,
            clusters: list[Cluster]) -> CoordinationResult:
    cluster_by_account: dict[str, str] = {}
    cluster_map = {c.cluster_id: c for c in clusters}
    for c in clusters:
        for aid in c.account_ids:
            cluster_by_account[aid] = c.cluster_id

    cluster_out: dict[str, ClusterCoordination] = {}
    for c in clusters:
        thr, share = _cluster_threshold_input(c, threshold)
        ind = statistics.fmean([individual[a].score for a in c.account_ids
                                if a in individual]) if c.account_ids else 0.0
        bd = _combine(ind, thr, c.network_evidence, c.benign_factor)

        categories = sorted({e.category for e in c.evidence_items
                             if e.strength in ("MODERATE", "HIGH")})
        if thr > 0 and share > 0:
            categories = sorted(set(categories) | {"population"})
        independent = len(categories)

        prio = _priority_score(bd.score, ind, independent, len(c.account_ids) - 1)
        cluster_out[c.cluster_id] = ClusterCoordination(
            cluster_id=c.cluster_id, account_ids=c.account_ids, breakdown=bd,
            in_window_share=share, evidence_categories=categories,
            independent_evidence_count=independent,
            investigation_priority=priority_for(prio),
        )

    account_out: dict[str, AccountCoordination] = {}
    for aid, f in features.items():
        cid = cluster_by_account.get(aid)
        ind = individual[aid].score if aid in individual else 0.0
        if cid is not None:
            c = cluster_map[cid]
            cc = cluster_out[cid]
            bd = _combine(ind, cc.breakdown.threshold, c.network_evidence, c.benign_factor)
            related = [a for a in c.account_ids if a != aid]
            categories = cc.evidence_categories
        else:
            sig = threshold.account_signals.get(aid)
            own = (sig.signal * NO_CLUSTER_THRESHOLD_CREDIT) if sig else 0.0
            bd = _combine(ind, own, 0.0, 1.0)
            related, categories = [], []
        account_out[aid] = AccountCoordination(
            account_id=aid, cluster_id=cid, related_accounts=related,
            breakdown=bd, evidence_categories=categories,
        )

    return CoordinationResult(clusters=cluster_out, accounts=account_out,
                              cluster_index=cluster_by_account)


def claim_severity(claim_type: str) -> float:
    return CLAIM_SEVERITY.get(claim_type, 0.3)
