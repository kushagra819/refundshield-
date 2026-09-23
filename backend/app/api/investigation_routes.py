"""RefundShield — investigation workflow endpoints (Phase 5 backend support).

These serve the investigator UI. They contain NO detection logic: every score is
read from the Phase 2-4 engines unchanged. Phase 3's and Phase 4's existing
contracts are untouched.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..config import SCORING_NOTICE, SYNTHETIC_NOTICE
from ..domain.models import ScenarioId
from ..engines import investigation as inv
from .routes import get_analysis

router = APIRouter()


def _meta() -> dict[str, Any]:
    return {"synthetic_notice": SYNTHETIC_NOTICE, "scoring_notice": SCORING_NOTICE}


class ActionRequest(BaseModel):
    action: str = Field(..., description="review | request_evidence | approve_refund | escalate")
    note: str | None = None
    scenario: str = ScenarioId.COORDINATED.value


class NotesRequest(BaseModel):
    note: str
    scenario: str = ScenarioId.COORDINATED.value


@router.get("/dashboard")
def dashboard(scenario: str = ScenarioId.COORDINATED.value,
              threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    return {**inv.dashboard(a), **_meta()}


@router.get("/activity")
def activity(scenario: str = ScenarioId.COORDINATED.value,
             limit: int = Query(8, ge=1, le=40),
             threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    """A feed built from real records — never a simulated event stream."""
    a = get_analysis(scenario, threshold)
    events: list[dict[str, Any]] = []
    for c in sorted(a.coordination.clusters.values(),
                    key=lambda x: -x.breakdown.score)[:3]:
        events.append({
            "kind": "cluster", "title": "Cluster identified",
            "subject": c.cluster_id,
            "detail": f"{len(c.account_ids)} linked accounts · coordination "
                      f"{c.breakdown.score:.1f} {c.breakdown.band}",
            "band": c.breakdown.band,
        })
    if a.threshold.reliable and a.threshold.bunching_score > 0:
        events.append({
            "kind": "threshold", "title": "Threshold anomaly detected",
            "subject": f"{a.threshold.threshold * 100:.0f}% review threshold",
            "detail": f"{a.threshold.observed_count} observed vs "
                      f"{a.threshold.expected_count:.2f} expected",
            "band": a.threshold.signal_band,
        })
    for r in a.queue[:limit]:
        events.append({
            "kind": "return", "title": "Return request prioritised",
            "subject": r.return_id,
            "detail": f"{r.account_id} · {r.claim_type} · {r.priority}",
            "band": r.coordination_band,
        })
    return {"events": events[:limit], "environment": "SYNTHETIC DEMO", **_meta()}


@router.get("/threshold-focus")
def threshold_focus(scenario: str = ScenarioId.COORDINATED.value,
                    threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    return {**inv.threshold_focus(a), **_meta()}


@router.get("/investigations/{return_id}")
def investigation(return_id: str,
                  scenario: str = ScenarioId.COORDINATED.value,
                  threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    try:
        return {**inv.case_file(a, return_id), **_meta()}
    except KeyError:
        raise HTTPException(404, f"Unknown return request '{return_id}'")


@router.post("/investigations/{return_id}/action")
def investigation_action(return_id: str, body: ActionRequest) -> dict[str, Any]:
    a = get_analysis(body.scenario, None)
    if not any(r.return_id == return_id for r in a.queue):
        raise HTTPException(404, f"Unknown return request '{return_id}'")
    try:
        state = inv.STORE.apply(body.scenario, return_id, body.action, body.note)
    except KeyError:
        raise HTTPException(400, f"Unknown action '{body.action}'")
    return {"return_id": return_id, "case_state": state.to_dict(), **_meta()}


@router.post("/investigations/{return_id}/notes")
def investigation_notes(return_id: str, body: NotesRequest) -> dict[str, Any]:
    state = inv.STORE.set_notes(body.scenario, return_id, body.note)
    return {"return_id": return_id, "case_state": state.to_dict(), **_meta()}


@router.get("/accounts/{account_id}/detail")
def account_detail(account_id: str,
                   scenario: str = ScenarioId.COORDINATED.value,
                   threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    if account_id not in a.features:
        raise HTTPException(404, f"Unknown account '{account_id}'")
    return {**inv.account_detail(a, account_id), **_meta()}


@router.get("/clusters/{cluster_id}/timeline")
def cluster_timeline(cluster_id: str,
                     scenario: str = ScenarioId.COORDINATED.value,
                     threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    if cluster_id not in a.cluster_map:
        raise HTTPException(404, f"Unknown cluster '{cluster_id}'")
    return {**inv.timeline(a, cluster_id), **_meta()}


@router.get("/clusters/{cluster_id}/why-not-individual")
def why_not_individual(cluster_id: str,
                       scenario: str = ScenarioId.COORDINATED.value,
                       threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    if cluster_id not in a.cluster_map:
        raise HTTPException(404, f"Unknown cluster '{cluster_id}'")
    return {**inv.why_not_individual(a, cluster_id), **_meta()}


@router.get("/search")
def search(q: str = Query(..., min_length=2),
           scenario: str = ScenarioId.COORDINATED.value) -> dict[str, Any]:
    """Global search across accounts, returns, clusters, devices and addresses."""
    a = get_analysis(scenario, None)
    needle = q.strip().upper()
    results: list[dict[str, Any]] = []

    for aid in a.features:
        if needle in aid.upper():
            ac = a.coordination.accounts[aid]
            results.append({
                "kind": "account", "id": aid,
                "primary": f"{a.features[aid].return_rate * 100:.1f}%",
                "badges": [{"label": "Individual", "band": a.individual[aid].band},
                           {"label": "Coordination", "band": ac.band}],
                "route": f"/accounts/{aid}",
            })
    for r in a.queue:
        if needle in r.return_id.upper():
            results.append({
                "kind": "return", "id": r.return_id,
                "primary": r.claim_type,
                "badges": [{"label": "Priority", "band": r.priority},
                           {"label": "Coordination", "band": r.coordination_band}],
                "route": f"/investigations/{r.return_id}",
            })
    for cid, c in a.coordination.clusters.items():
        if needle in cid.upper():
            results.append({
                "kind": "cluster", "id": cid,
                "primary": f"{len(c.account_ids)} accounts",
                "badges": [{"label": "Coordination", "band": c.breakdown.band}],
                "route": f"/network?cluster={cid}",
            })
    seen_entities: set[str] = set()
    for cl in a.clusters:
        for dev in cl.shared_devices:
            if needle in dev.upper() and dev not in seen_entities:
                seen_entities.add(dev)
                results.append({"kind": "device", "id": dev,
                                "primary": f"{len(cl.shared_devices[dev])} accounts",
                                "badges": [], "route": f"/network?cluster={cl.cluster_id}"})
        for addr in cl.shared_addresses:
            if needle in addr.upper() and addr not in seen_entities:
                seen_entities.add(addr)
                results.append({"kind": "address", "id": addr,
                                "primary": f"{len(cl.shared_addresses[addr])} accounts",
                                "badges": [], "route": f"/network?cluster={cl.cluster_id}"})

    return {"query": q, "results": results[:20], "total": len(results), **_meta()}


@router.get("/limitations")
def limitations() -> dict[str, Any]:
    """Truthful boundary between prototype demonstration and production deployment."""
    return {
        "limitations": [
            "Synthetic demonstration data — no real customer records.",
            "Threshold bunching is a detection mechanism, not proof of fraud.",
            "Graph clustering is heuristic; oversized components are split by modularity.",
            "Legitimate shared infrastructure (households, offices) can create overlap.",
            "Rings with no detectable shared attributes may remain hidden.",
            "No payment or refund-destination identifier is currently modelled.",
            "Scores are explainable prioritisation values, not validated fraud probabilities.",
        ],
        "production_evolution": [
            "Validated labelled or de-identified return data",
            "Additional transaction and refund-destination relationships",
            "Calibrated fraud-risk models",
            "More advanced graph analytics",
            "Continuous model validation",
            "Human feedback loop from investigator decisions",
        ],
        **_meta(),
    }
