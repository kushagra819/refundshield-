"""RefundShield — investigation queue and the assembled pipeline (Phase 4).

Answers the investigator's only real question: *which return request should I
open first, and why?*

Nothing here denies a refund. Every row carries a recommended action of
PRIORITISE FOR REVIEW and a status a human moves through.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

from ..config import SETTINGS, band_for, priority_for
from ..domain.models import Dataset, ScenarioId
from . import coordination_engine as ce
from . import explainability as ex
from . import network_engine as ne
from . import threshold_engine as te
from .features import AccountFeatures, PopulationContext, build_features
from .individual_risk import IndividualRisk, score_all

STATUS_AWAITING = "Awaiting review"
ACTIONS = ["Review Evidence", "Mark Reviewed", "Request More Information", "Escalate"]


@dataclass
class QueueRow:
    rank: int
    priority: str
    priority_score: float
    return_id: str
    account_id: str
    order_id: str
    claim_type: str
    refund_inr: float
    filed_on: date
    return_rate: float
    individual_risk: float
    individual_band: str
    threshold_signal: float
    threshold_band: str
    network_evidence: float
    network_band: str
    coordination_risk: float
    coordination_band: str
    cluster_id: str | None
    related_accounts: int
    primary_reasons: list[str]
    status: str = STATUS_AWAITING

    def to_dict(self) -> dict[str, Any]:
        return {
            "rank": self.rank,
            "priority": self.priority,
            "priority_label": f"P{self.rank}",
            "priority_score": round(self.priority_score, 1),
            "return_id": self.return_id,
            "account_id": self.account_id,
            "order_id": self.order_id,
            "claim_type": self.claim_type,
            "refund_inr": self.refund_inr,
            "filed_on": self.filed_on.isoformat(),
            "return_rate_pct": round(self.return_rate * 100, 1),
            "individual_risk": round(self.individual_risk, 1),
            "individual_band": self.individual_band,
            "threshold_signal": round(self.threshold_signal, 1),
            "threshold_band": self.threshold_band,
            "network_evidence": round(self.network_evidence, 1),
            "network_band": self.network_band,
            "coordination_risk": round(self.coordination_risk, 1),
            "coordination_band": self.coordination_band,
            "cluster_id": self.cluster_id,
            "related_accounts": self.related_accounts,
            "primary_reasons": self.primary_reasons,
            "status": self.status,
            "recommended_action": ce.RECOMMENDED_ACTION,
            "available_actions": ACTIONS,
        }


@dataclass
class Analysis:
    """Everything the API needs for one scenario, computed once."""
    scenario: ScenarioId
    dataset: Dataset
    features: dict[str, AccountFeatures]
    context: PopulationContext
    individual: dict[str, IndividualRisk]
    threshold: te.ThresholdEvasionResult
    graph: ne.RelationshipGraph
    clusters: list[ne.Cluster]
    coordination: ce.CoordinationResult
    queue: list[QueueRow] = field(default_factory=list)

    @property
    def cluster_map(self) -> dict[str, ne.Cluster]:
        return {c.cluster_id: c for c in self.clusters}

    def explain_cluster(self, cluster_id: str) -> ex.Explanation:
        return ex.explain_cluster(
            self.cluster_map[cluster_id], self.coordination.clusters[cluster_id],
            self.threshold, self.features, self.individual)

    def explain_account(self, account_id: str) -> ex.Explanation:
        return ex.explain_account(account_id, self.coordination, self.cluster_map,
                                  self.threshold, self.features, self.individual)

    def summary(self) -> dict[str, Any]:
        high = [c for c in self.coordination.clusters.values()
                if c.breakdown.band in ("HIGH", "VERY HIGH")]
        prioritised = [r for r in self.queue if r.priority in ("HIGH", "URGENT")]
        return {
            "scenario": self.scenario.value,
            "total_return_requests": len(self.dataset.returns),
            "prioritised_for_review": len(prioritised),
            "high_coordination_clusters": len(high),
            "near_threshold_clusters": sum(
                1 for c in self.coordination.clusters.values() if c.in_window_share > 0),
            "awaiting_review": sum(1 for r in self.queue if r.status == STATUS_AWAITING),
            "threshold_signal": round(self.threshold.bunching_score, 1),
            "threshold_band": self.threshold.signal_band,
            "clusters_found": len(self.clusters),
            "accounts": len(self.dataset.accounts),
        }


def _primary_reasons(cluster: ne.Cluster | None, ind: IndividualRisk,
                     in_window: bool) -> list[str]:
    out: list[str] = []
    if in_window:
        out.append("Near-threshold cluster")
    if cluster:
        if cluster.shared_devices:
            out.append("Shared device")
        if cluster.shared_addresses:
            out.append("Common address")
        if cluster.temporal_overlap >= 0.30:
            out.append("Similar claim timing")
        if cluster.components.get("category_overlap", 0) >= 0.50:
            out.append("Product overlap")
    if ind.signals and ind.band in ("HIGH", "VERY HIGH"):
        out.append(ind.signals[0].label)
    return out[:4] or ["Routine claim"]


def build_queue(ds: Dataset, features: dict[str, AccountFeatures],
                individual: dict[str, IndividualRisk],
                threshold: te.ThresholdEvasionResult,
                clusters: list[ne.Cluster],
                coordination: ce.CoordinationResult) -> list[QueueRow]:
    cmap = {c.cluster_id: c for c in clusters}
    rows: list[QueueRow] = []

    for r in ds.returns:
        aid = r.account_id
        f = features.get(aid)
        ind = individual.get(aid)
        if f is None or ind is None:
            continue
        ac = coordination.accounts[aid]
        cluster = cmap.get(ac.cluster_id) if ac.cluster_id else None
        sig = threshold.account_signals.get(aid)
        in_window = bool(sig and sig.in_window)

        severity = ce.claim_severity(r.claim_type)
        w = SETTINGS.queue
        score = max(0.0, min(100.0,
                             w.coordination * ac.score
                             + w.individual * ind.score
                             + w.claim_severity * severity * 100.0))
        rows.append(QueueRow(
            rank=0, priority=priority_for(score), priority_score=score,
            return_id=r.return_id, account_id=aid, order_id=r.order_id,
            claim_type=r.claim_type, refund_inr=r.refund_inr, filed_on=r.filed_on,
            return_rate=f.return_rate,
            individual_risk=ind.score, individual_band=ind.band,
            threshold_signal=ac.breakdown.threshold,
            threshold_band=band_for(ac.breakdown.threshold),
            network_evidence=cluster.network_evidence if cluster else 0.0,
            network_band=cluster.network_band if cluster else "LOW",
            coordination_risk=ac.score, coordination_band=ac.band,
            cluster_id=ac.cluster_id, related_accounts=len(ac.related_accounts),
            primary_reasons=_primary_reasons(cluster, ind, in_window),
        ))

    rows.sort(key=lambda x: (-x.priority_score, x.return_id))
    for i, row in enumerate(rows, start=1):
        row.rank = i
    return rows


def run(ds: Dataset, threshold_value: float | None = None) -> Analysis:
    """The whole pipeline, in the order the architecture diagram describes."""
    features, ctx = build_features(ds)
    individual = score_all(features, ctx)
    thr = te.analyse(features, threshold=threshold_value)
    graph, clusters = ne.analyse(ds, features)
    coordination = ce.analyse(ds, features, individual, thr, clusters)
    queue = build_queue(ds, features, individual, thr, clusters, coordination)
    return Analysis(scenario=ds.scenario, dataset=ds, features=features, context=ctx,
                    individual=individual, threshold=thr, graph=graph,
                    clusters=clusters, coordination=coordination, queue=queue)
