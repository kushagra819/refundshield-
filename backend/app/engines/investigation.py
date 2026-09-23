"""RefundShield — investigation workflow (Phase 5).

Assembles what an investigator actually needs to work a case: a dashboard of
what needs attention, a full case file per return request, grouped evidence, a
timeline built from real filing dates, and a local human-review state.

NO DETECTION LOGIC LIVES HERE. Every score is read from the Phase 2-4 engines
and passed through unchanged; this module only organises, groups and explains.
If a number appears on a screen, it was computed upstream.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from ..config import SETTINGS, evidence_strength
from ..domain.models import ScenarioId
from .queue import Analysis, QueueRow

# --------------------------------------------------------------------------
# Human-review workflow
# --------------------------------------------------------------------------
STATUS_AWAITING = "Awaiting review"
STATUS_IN_REVIEW = "In review"
STATUS_INFO_REQUESTED = "More evidence requested"
STATUS_ESCALATED = "Escalated for investigation"
STATUS_REFUND_APPROVED = "Refund approved"

# Deliberately no "deny refund" action anywhere in this system.
ACTIONS: dict[str, str] = {
    "review": STATUS_IN_REVIEW,
    "request_evidence": STATUS_INFO_REQUESTED,
    "approve_refund": STATUS_REFUND_APPROVED,
    "escalate": STATUS_ESCALATED,
}
ACTION_LABELS: dict[str, str] = {
    "review": "Review Evidence",
    "request_evidence": "Request More Evidence",
    "approve_refund": "Approve Refund",
    "escalate": "Escalate for Investigation",
}
DEMO_ACTION_NOTICE = "Demo action — no real refund or payment action performed."


@dataclass
class CaseState:
    status: str = STATUS_AWAITING
    notes: str = ""
    history: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"status": self.status, "notes": self.notes, "history": self.history,
                "notice": DEMO_ACTION_NOTICE}


class CaseStore:
    """In-memory human-review state. Resets with the process; never persisted."""

    def __init__(self) -> None:
        self._cases: dict[tuple[str, str], CaseState] = {}

    def get(self, scenario: str, return_id: str) -> CaseState:
        return self._cases.get((scenario, return_id), CaseState())

    def apply(self, scenario: str, return_id: str, action: str,
              note: str | None = None) -> CaseState:
        if action not in ACTIONS:
            raise KeyError(action)
        state = self._cases.setdefault((scenario, return_id), CaseState())
        state.status = ACTIONS[action]
        if note is not None:
            state.notes = note
        state.history.append({"action": action, "label": ACTION_LABELS[action],
                              "status": state.status})
        return state

    def set_notes(self, scenario: str, return_id: str, note: str) -> CaseState:
        state = self._cases.setdefault((scenario, return_id), CaseState())
        state.notes = note
        return state

    def reset(self) -> None:
        self._cases.clear()

    def reviewed_count(self, scenario: str) -> int:
        return sum(1 for (s, _), c in self._cases.items()
                   if s == scenario and c.status != STATUS_AWAITING)


STORE = CaseStore()


# --------------------------------------------------------------------------
# Dashboard
# --------------------------------------------------------------------------
def dashboard(a: Analysis) -> dict[str, Any]:
    """Everything the investigator's landing screen needs. All read, none invented."""
    clusters = list(a.coordination.clusters.values())
    urgent = [r for r in a.queue if r.priority == "URGENT"]
    high_priority = [r for r in a.queue if r.priority in ("URGENT", "HIGH")]
    high_coord = [c for c in clusters if c.breakdown.band in ("HIGH", "VERY HIGH")]
    high_individual = [aid for aid, r in a.individual.items()
                       if r.band in ("HIGH", "VERY HIGH")]
    near_threshold = [c for c in clusters if c.in_window_share > 0]
    reviewed = STORE.reviewed_count(a.scenario.value)

    # Priority bands differ by unit: a CLUSTER can reach URGENT, while an
    # individual return row tops out lower because claim severity is only 15% of
    # its score. Counting "urgent return requests" would truthfully report 0
    # while an URGENT cluster sits right there, so the card counts the rows an
    # investigator would actually work first and the urgent CLUSTER count is
    # reported separately in totals.
    urgent_clusters = [c for c in clusters if c.investigation_priority == "URGENT"]
    cards = [
        {"key": "urgent", "label": "Priority investigations", "value": len(high_priority),
         "band": "VERY HIGH" if urgent_clusters else ("HIGH" if high_priority else "LOW"),
         "link": "queue",
         "hint": "Return requests whose combined evidence puts them at the top of the queue."},
        {"key": "coordination", "label": "High coordination risk", "value": len(high_coord),
         "band": "HIGH" if high_coord else "LOW", "link": "network",
         "hint": "Account groups where network, threshold and behavioural evidence reinforce."},
        {"key": "threshold", "label": "Threshold anomalies", "value": len(near_threshold),
         "band": a.threshold.signal_band if a.threshold.bunching_score > 0 else "LOW",
         "link": "threshold",
         "hint": "Groups with members parked immediately below the seller's review threshold."},
        {"key": "clusters", "label": "Active clusters", "value": len(clusters),
         "band": "LOW", "link": "network",
         "hint": "Account groups linked by shared or similar attributes."},
    ]
    return {
        "scenario": a.scenario.value,
        "cards": cards,
        "totals": {
            "return_requests": len(a.dataset.returns),
            "accounts": len(a.dataset.accounts),
            "prioritised": len(high_priority),
            "urgent": len(urgent),
            "high_coordination_clusters": len(high_coord),
            "high_individual_accounts": len(high_individual),
            "active_clusters": len(clusters),
            "near_threshold_clusters": len(near_threshold),
            "urgent_clusters": len(urgent_clusters),
            "awaiting_review": len(a.queue) - reviewed,
            "reviewed": reviewed,
        },
        "threshold": {
            "value": a.threshold.threshold,
            "signal": round(a.threshold.bunching_score, 1),
            "band": a.threshold.signal_band,
            "observed": a.threshold.observed_count,
            "expected": round(a.threshold.expected_count, 2),
        },
    }


# --------------------------------------------------------------------------
# Evidence, grouped for display
# --------------------------------------------------------------------------
CATEGORY_ORDER = ["INDIVIDUAL", "THRESHOLD", "RELATIONAL", "TEMPORAL", "BEHAVIOURAL"]
CATEGORY_MAP = {"population": "THRESHOLD", "relational": "RELATIONAL",
                "temporal": "TEMPORAL", "behavioural": "BEHAVIOURAL"}
CATEGORY_HINTS = {
    "INDIVIDUAL": "What this account's own return behaviour looks like.",
    "THRESHOLD": "Whether the wider population is concentrated below the review threshold.",
    "RELATIONAL": "Attributes shared with other accounts.",
    "TEMPORAL": "When the claims were filed relative to each other.",
    "BEHAVIOURAL": "How similarly the linked accounts behave.",
}


def evidence_groups(a: Analysis, account_id: str) -> list[dict[str, Any]]:
    """Group every piece of evidence behind one account's priority, by category."""
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)

    ind = a.individual[account_id]
    f = a.features[account_id]
    groups["INDIVIDUAL"].append({
        "title": "Individual return risk",
        "value": f"{ind.score:.1f} / 100",
        "strength": ind.band,
        "explanation": (f"{f.return_rate * 100:.1f}% of {f.order_count} orders returned. "
                        f"{len(ind.signals)} individual rule(s) contributed."),
    })
    for s in ind.signals:
        groups["INDIVIDUAL"].append({
            "title": s.label, "value": f"+{s.points:.1f} pts",
            "strength": evidence_strength(min(1.0, s.points / 22.0)),
            "explanation": s.detail,
        })

    sig = a.threshold.account_signals.get(account_id)
    thr = a.threshold
    if sig and sig.in_window:
        groups["THRESHOLD"].append({
            "title": "Return rate sits inside the review band",
            "value": f"{sig.return_rate * 100:.1f}%",
            "strength": evidence_strength(sig.signal / 100.0),
            "explanation": (f"Between {thr.window[0] * 100:.0f}% and "
                            f"{thr.window[1] * 100:.0f}%, immediately below the seller's "
                            f"{thr.threshold * 100:.0f}% threshold."),
        })
    if thr.reliable and thr.bunching_score > 0:
        groups["THRESHOLD"].append({
            "title": "Near-threshold clustering across the population",
            "value": f"{thr.observed_count} observed vs {thr.expected_count:.2f} expected",
            "strength": thr.signal_band,
            "explanation": (f"Excess of {thr.excess_count:+.2f} accounts in the band "
                            f"(p = {thr.p_value:.4f}). A population-level anomaly signal "
                            f"that contributes to investigation priority."),
        })

    ac = a.coordination.accounts[account_id]
    if ac.cluster_id:
        cluster = a.cluster_map[ac.cluster_id]
        for item in cluster.evidence_items:
            groups[CATEGORY_MAP.get(item.category, "BEHAVIOURAL")].append({
                "title": item.label,
                "value": f"{item.value:.2f}",
                "strength": item.strength,
                "explanation": item.detail,
            })

    return [{"category": c, "hint": CATEGORY_HINTS[c], "items": groups[c]}
            for c in CATEGORY_ORDER if groups[c]]


def evidence_stack(a: Analysis, account_id: str) -> list[dict[str, Any]]:
    """The four streams as one readable stack, ending in the combined score."""
    ac = a.coordination.accounts[account_id]
    b = ac.breakdown
    cluster = a.cluster_map.get(ac.cluster_id) if ac.cluster_id else None
    temporal = (cluster.temporal_overlap * 100) if cluster else 0.0
    from ..config import band_for
    return [
        {"label": "Individual behaviour", "score": round(b.individual, 1),
         "band": band_for(b.individual),
         "hint": "How this account's own return behaviour scores on its own."},
        {"label": "Threshold evasion", "score": round(b.threshold, 1),
         "band": band_for(b.threshold),
         "hint": ("Measures unusual concentration of accounts immediately below the "
                  "seller's review threshold.")},
        {"label": "Network evidence", "score": round(b.network, 1),
         "band": band_for(b.network),
         "hint": ("Measures relationships between accounts based on shared or similar "
                  "attributes.")},
        {"label": "Temporal alignment", "score": round(temporal, 1),
         "band": band_for(temporal),
         "hint": "How closely the linked accounts filed their claims in time."},
    ]


# --------------------------------------------------------------------------
# Why individual scoring did not catch it
# --------------------------------------------------------------------------
def why_not_individual(a: Analysis, cluster_id: str) -> dict[str, Any]:
    """The CX0507 argument, stated with this cluster's real numbers."""
    cluster = a.cluster_map[cluster_id]
    theta = SETTINGS.threshold
    rows = [{
        "account_id": aid,
        "return_rate_pct": round(a.features[aid].return_rate * 100, 1),
        "individual_risk": round(a.individual[aid].score, 1),
        "individual_band": a.individual[aid].band,
        "below_threshold": a.features[aid].return_rate < theta,
    } for aid in cluster.account_ids]
    rates = [r["return_rate_pct"] for r in rows]
    scores = [r["individual_risk"] for r in rows]
    all_below = all(r["below_threshold"] for r in rows)
    all_low = all(r["individual_band"] == "LOW" for r in rows)

    return {
        "cluster_id": cluster_id,
        "threshold_pct": round(theta * 100, 1),
        "accounts": rows,
        "rate_range_pct": [min(rates), max(rates)] if rates else [0, 0],
        "individual_range": [min(scores), max(scores)] if scores else [0, 0],
        "all_below_threshold": all_below,
        "all_individually_low": all_low,
        "headline": ("Individual scoring alone does not flag these accounts"
                     if all_below and all_low
                     else "Individual scoring gives a partial picture here"),
        "explanation": (
            f"Each account remains below the seller's {theta * 100:.0f}% threshold, so "
            f"individual behaviour alone does not produce a high-risk result "
            f"({min(scores):.1f}-{max(scores):.1f} of 100, all LOW)."
            if all_below and all_low else
            f"Individual risk across this group ranges {min(scores):.1f}-{max(scores):.1f} "
            f"of 100."),
        "consequence": ("RefundShield therefore evaluates population-level threshold "
                        "behaviour and cross-account relationships."),
    }


# --------------------------------------------------------------------------
# Timeline — built from real dates only
# --------------------------------------------------------------------------
def timeline(a: Analysis, cluster_id: str) -> dict[str, Any]:
    cluster = a.cluster_map[cluster_id]
    members = set(cluster.account_ids)
    events: list[dict[str, Any]] = []

    index = a.dataset.account_index()
    for aid in cluster.account_ids:
        acc = index.get(aid)
        if acc:
            events.append({"date": acc.created_on.isoformat(), "kind": "account_created",
                           "account_id": aid, "label": "Account created", "detail": aid})
    for r in a.dataset.returns:
        if r.account_id in members:
            events.append({"date": r.filed_on.isoformat(), "kind": "claim",
                           "account_id": r.account_id, "return_id": r.return_id,
                           "label": r.claim_type,
                           "detail": f"{r.return_id} · ₹{r.refund_inr:,.0f}"})
    events.sort(key=lambda e: (e["date"], e.get("return_id") or "", e["account_id"]))

    claims = [e for e in events if e["kind"] == "claim"]
    window = None
    if claims:
        lo, hi = claims[0]["date"], claims[-1]["date"]
        span = (date.fromisoformat(hi) - date.fromisoformat(lo)).days
        window = {"start": lo, "end": hi, "span_days": span,
                  "label": f"Activity window: {lo} → {hi} ({span} days)"}
    return {"cluster_id": cluster_id, "events": events, "claim_window": window,
            "claim_count": len(claims)}


# --------------------------------------------------------------------------
# Account detail
# --------------------------------------------------------------------------
def account_detail(a: Analysis, account_id: str) -> dict[str, Any]:
    f = a.features[account_id]
    ind = a.individual[account_id]
    ac = a.coordination.accounts[account_id]
    sig = a.threshold.account_signals.get(account_id)
    cluster = a.cluster_map.get(ac.cluster_id) if ac.cluster_id else None
    prioritised = ac.band in ("HIGH", "VERY HIGH") or ind.band in ("HIGH", "VERY HIGH")

    if prioritised and ind.band == "LOW":
        verdict = "WHY THIS ACCOUNT IS PRIORITISED"
        rationale = ("Individually this account looks acceptable, but it sits in a group "
                     "where threshold and relational evidence reinforce one another.")
    elif prioritised:
        verdict = "WHY THIS ACCOUNT IS PRIORITISED"
        rationale = "This account's own return behaviour carries the case."
    elif cluster:
        verdict = "WHY THIS ACCOUNT IS NOT PRIORITISED"
        rationale = ("Shared attributes with other accounts are present, but the "
                     "behavioural and threshold evidence does not reinforce them.")
    else:
        verdict = "WHY THIS ACCOUNT IS NOT PRIORITISED"
        rationale = ("No group relationships and no unusual individual behaviour were "
                     "found for this account.")

    return {
        "account_id": account_id,
        "orders": f.order_count,
        "returns": f.return_count,
        "return_rate_pct": round(f.return_rate * 100, 1),
        "account_age_days": f.account_age_days,
        "categories": f.categories,
        "devices": f.device_ids,
        "address": f.address_id,
        "individual_risk": round(ind.score, 1), "individual_band": ind.band,
        "threshold_signal": round(sig.signal, 1) if sig else 0.0,
        "threshold_band": sig.band if sig else "LOW",
        "in_window": bool(sig and sig.in_window),
        "network_evidence": round(cluster.network_evidence, 1) if cluster else 0.0,
        "network_band": cluster.network_band if cluster else "LOW",
        "coordination_risk": round(ac.score, 1), "coordination_band": ac.band,
        "cluster_id": ac.cluster_id,
        "related_accounts": ac.related_accounts,
        "prioritised": prioritised,
        "verdict": verdict,
        "rationale": rationale,
        "evidence_groups": evidence_groups(a, account_id),
        "evidence_stack": evidence_stack(a, account_id),
        "explanation": a.explain_account(account_id).to_dict(),
    }


# --------------------------------------------------------------------------
# Full case file for one return request
# --------------------------------------------------------------------------
def case_file(a: Analysis, return_id: str) -> dict[str, Any]:
    row: QueueRow | None = next((r for r in a.queue if r.return_id == return_id), None)
    if row is None:
        raise KeyError(return_id)
    rec = next(r for r in a.dataset.returns if r.return_id == return_id)
    order = a.dataset.order_index()[rec.order_id]
    f = a.features[row.account_id]
    ac = a.coordination.accounts[row.account_id]

    out: dict[str, Any] = {
        "return": {
            "return_id": rec.return_id, "account_id": rec.account_id,
            "order_id": rec.order_id, "claim_type": rec.claim_type,
            "refund_inr": rec.refund_inr, "order_value_inr": order.value_inr,
            "filed_on": rec.filed_on.isoformat(),
            "days_since_delivery": rec.days_since_delivery,
            "category": order.category,
            "account_age_days": f.account_age_days,
        },
        "risk_summary": {
            "individual": {"score": round(row.individual_risk, 1), "band": row.individual_band},
            "threshold": {"score": round(row.threshold_signal, 1), "band": row.threshold_band},
            "network": {"score": round(row.network_evidence, 1), "band": row.network_band},
            "coordination": {"score": round(row.coordination_risk, 1),
                             "band": row.coordination_band},
            "priority": row.priority,
            "priority_score": round(row.priority_score, 1),
            "notice": "Prototype coordination score — not a fraud probability.",
        },
        "account": account_detail(a, row.account_id),
        "cluster_id": ac.cluster_id,
        "primary_reasons": row.primary_reasons,
        "recommended_action": "PRIORITISE FOR REVIEW",
        "action_note": ("RefundShield prioritises cases for investigation. "
                        "It does not automatically deny refunds."),
        "available_actions": [{"key": k, "label": ACTION_LABELS[k]} for k in ACTIONS],
        "case_state": STORE.get(a.scenario.value, return_id).to_dict(),
    }
    if ac.cluster_id:
        out["explanation"] = a.explain_cluster(ac.cluster_id).to_dict()
        out["why_not_individual"] = why_not_individual(a, ac.cluster_id)
        out["timeline"] = timeline(a, ac.cluster_id)
        out["cluster"] = {**a.cluster_map[ac.cluster_id].to_dict(),
                          "coordination": a.coordination.clusters[ac.cluster_id].to_dict()}
    else:
        out["explanation"] = a.explain_account(row.account_id).to_dict()
        out["why_not_individual"] = None
        out["timeline"] = {"cluster_id": None, "events": [], "claim_window": None,
                           "claim_count": 0}
        out["cluster"] = None
    return out


# --------------------------------------------------------------------------
# Threshold-focused view (presentation only — no algorithm change)
# --------------------------------------------------------------------------
def threshold_focus(a: Analysis, low: float = 0.12, high: float = 0.22) -> dict[str, Any]:
    """The bins around the threshold only.

    The full-population chart is dominated by the 0% bin (accounts with no
    returns at all), which visually compresses the region that matters. This
    returns the same bins, unchanged, filtered to a readable range. The
    threshold algorithm and its inputs are untouched.
    """
    t = a.threshold
    bins = [b.to_dict() for b in t.bins if low - 1e-9 <= b.lower < high]
    return {
        "threshold": t.threshold, "threshold_pct": round(t.threshold * 100, 1),
        "window_pct": [round(t.window[0] * 100, 1), round(t.window[1] * 100, 1)],
        "range_pct": [round(low * 100, 1), round(high * 100, 1)],
        "bins": bins,
        "observed_count": t.observed_count,
        "expected_count": round(t.expected_count, 2),
        "excess_count": round(t.excess_count, 2),
        "p_value": round(t.p_value, 6),
        "bunching_score": round(t.bunching_score, 1),
        "signal_band": t.signal_band,
        "eligible_accounts": t.eligible_accounts,
        "plain_english": (
            f"More accounts than expected are concentrated immediately below the "
            f"seller's {t.threshold * 100:.0f}% review threshold."
            if t.excess_count > 0 else
            f"No excess concentration of accounts below the seller's "
            f"{t.threshold * 100:.0f}% review threshold."),
        "caveat": t.caveat,
        "full_chart_available": True,
    }
