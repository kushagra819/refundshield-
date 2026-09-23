"""RefundShield — explainability engine (Phase 4).

Turns computed evidence into numbered, human-readable reasons. Every sentence is
generated from actual values in the dataset; nothing is a fixed template with a
conclusion baked in, and no sentence asserts that anyone committed fraud.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..config import SETTINGS
from .coordination_engine import ClusterCoordination, CoordinationResult
from .features import AccountFeatures
from .individual_risk import IndividualRisk
from .network_engine import Cluster
from .threshold_engine import ThresholdEvasionResult

CLOSING_LINE = ("These combined signals increase coordination risk. "
                "No single signal independently establishes fraud.")
NO_SINGLE_ATTRIBUTE = ("No single shared attribute proves fraud. Multiple behavioural "
                       "and relational signals strengthen investigation priority.")
HUMAN_IN_THE_LOOP = ("RefundShield prioritises cases for investigation. "
                     "It does not automatically deny refunds.")


@dataclass
class Explanation:
    subject: str
    headline: str
    reasons: list[str] = field(default_factory=list)
    closing: str = CLOSING_LINE
    caveat: str = NO_SINGLE_ATTRIBUTE
    human_in_the_loop: str = HUMAN_IN_THE_LOOP

    def to_dict(self) -> dict[str, Any]:
        return {
            "subject": self.subject,
            "headline": self.headline,
            "reasons": self.reasons,
            "closing": self.closing,
            "caveat": self.caveat,
            "human_in_the_loop": self.human_in_the_loop,
        }


def _pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def explain_cluster(cluster: Cluster, coord: ClusterCoordination,
                    threshold: ThresholdEvasionResult,
                    features: dict[str, AccountFeatures],
                    individual: dict[str, IndividualRisk]) -> Explanation:
    theta = threshold.threshold
    members = cluster.account_ids
    reasons: list[str] = []

    # 1. how the members look individually
    bands = {individual[a].band for a in members if a in individual}
    below = [a for a in members
             if a in features and features[a].return_rate < theta]
    if len(below) == len(members):
        reasons.append(
            f"All {len(members)} accounts remain below the seller's "
            f"{_pct(theta)} return-rate threshold."
        )
    elif below:
        reasons.append(
            f"{len(below)} of {len(members)} accounts remain below the seller's "
            f"{_pct(theta)} return-rate threshold."
        )
    if bands and bands <= {"LOW"}:
        reasons.append(
            f"Every account scores LOW on individual return risk "
            f"({min(individual[a].score for a in members):.0f}-"
            f"{max(individual[a].score for a in members):.0f} of 100)."
        )

    # 2. where their rates sit
    lo, hi = cluster.return_rate_range
    if len(members) > 1:
        reasons.append(
            f"Their return rates cluster between {_pct(lo)} and {_pct(hi)}."
        )

    # 3. population-level bunching
    if threshold.reliable and threshold.bunching_score > 0 and coord.in_window_share > 0:
        in_window = int(round(coord.in_window_share * len(members)))
        reasons.append(
            f"{in_window} of these accounts sit inside the "
            f"{_pct(threshold.window[0])}-{_pct(threshold.window[1])} band, where the "
            f"seller's wider distribution predicts {threshold.expected_count:.1f} accounts "
            f"in total but {threshold.observed_count} are observed "
            f"(p = {threshold.p_value:.4f})."
        )

    # 4-N. relational and behavioural evidence, from actual values
    for dev, m in sorted(cluster.shared_devices.items()):
        reasons.append(f"{len(m)} accounts share device {dev}: {', '.join(m)}.")
    for addr, m in sorted(cluster.shared_addresses.items()):
        reasons.append(f"{len(m)} accounts share address {addr}: {', '.join(m)}.")
    if cluster.shared_categories and cluster.components.get("category_overlap", 0) >= 0.30:
        reasons.append(
            f"Claims concentrate on shared product categories "
            f"({', '.join(cluster.shared_categories)})."
        )
    if cluster.claim_window and cluster.temporal_overlap >= 0.30:
        a, b = cluster.claim_window
        span = (b - a).days
        reasons.append(
            f"Claims overlap within a {span}-day period "
            f"({a.isoformat()} to {b.isoformat()})."
        )
    if cluster.behavioural_similarity >= 0.60:
        reasons.append(
            f"Members show similar return behaviour "
            f"(mean pairwise similarity {cluster.behavioural_similarity:.2f})."
        )

    # benign counter-evidence, stated even when it does not win
    bi = cluster.benign_indicators
    if cluster.benign_factor <= 0.40:
        reasons.append(
            f"Counter-evidence: members buy across "
            f"{bi.get('avg_categories_per_member', 0):.1f} product categories on average, "
            f"have co-existed for {bi.get('shared_lifespan_days', 0):.0f} days and claim "
            f"across a {bi.get('claim_span_days', 0):.0f}-day span — consistent with an "
            f"ordinary shared household rather than a coordinated group."
        )

    band = coord.breakdown.band
    if cluster.benign_factor <= 0.40:
        headline = (f"Shared relationships present; coordination risk remains {band} "
                    f"({coord.breakdown.score:.0f}/100)")
    elif band in ("HIGH", "VERY HIGH"):
        headline = (f"Potential coordinated return abuse — coordination risk {band} "
                    f"({coord.breakdown.score:.0f}/100)")
    else:
        headline = (f"Possible coordination requiring further review — {band} "
                    f"({coord.breakdown.score:.0f}/100)")

    closing = CLOSING_LINE
    if cluster.benign_factor <= 0.40:
        closing = ("Shared household relationships are present, but behavioural and "
                   "threshold evidence do not indicate coordinated abuse.")

    return Explanation(subject=cluster.cluster_id, headline=headline,
                       reasons=reasons, closing=closing)


def explain_account(account_id: str, coordination: CoordinationResult,
                    clusters: dict[str, Cluster], threshold: ThresholdEvasionResult,
                    features: dict[str, AccountFeatures],
                    individual: dict[str, IndividualRisk]) -> Explanation:
    ac = coordination.accounts[account_id]
    ind = individual[account_id]
    f = features[account_id]
    reasons: list[str] = [
        f"Individual return risk is {ind.score:.0f}/100 ({ind.band}) on a return rate "
        f"of {_pct(f.return_rate)} across {f.order_count} orders."
    ]
    for s in ind.signals[:3]:
        reasons.append(f"Individual signal — {s.label}: {s.detail}")

    if ac.cluster_id and ac.cluster_id in clusters:
        c = clusters[ac.cluster_id]
        reasons.append(
            f"The account belongs to group {ac.cluster_id}, which contains "
            f"{len(c.account_ids)} accounts linked by "
            f"{', '.join(sorted({e.label.lower() for e in c.evidence_items})) or 'shared attributes'}."
        )
        sig = threshold.account_signals.get(account_id)
        if sig and sig.in_window:
            reasons.append(
                f"Its return rate of {_pct(f.return_rate)} sits inside the "
                f"{_pct(threshold.window[0])}-{_pct(threshold.window[1])} band immediately "
                f"below the seller's threshold."
            )
        reasons.append(
            f"Group evidence: network {c.network_evidence:.0f}/100, "
            f"threshold signal {ac.breakdown.threshold:.0f}/100."
        )
        if ind.band == "LOW" and ac.band in ("HIGH", "VERY HIGH"):
            headline = ("Individually low risk, but part of a group showing near-threshold "
                        "clustering and multiple overlapping relationships")
        else:
            headline = (f"Coordination risk {ac.band} ({ac.score:.0f}/100) "
                        f"within group {ac.cluster_id}")
    else:
        headline = (f"No meaningful group relationships found — coordination risk "
                    f"{ac.band} ({ac.score:.0f}/100)")
        reasons.append(
            "The account shares no device, address or behavioural pattern with other "
            "accounts strongly enough to form a group, so this is assessed as "
            "individual behaviour rather than coordination."
        )

    return Explanation(subject=account_id, headline=headline, reasons=reasons)
