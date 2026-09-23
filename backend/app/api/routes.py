"""RefundShield — HTTP API (Phase 4).

Serves the analysis the frontend needs. Results are computed once per
(scenario, threshold) and cached, because the pipeline is deterministic.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from ..config import (
    SCORING_NOTICE,
    SETTINGS,
    SYNTHETIC_NOTICE,
    band_table,
)
from ..data.generator import generate
from ..domain.models import SCENARIO_META, ScenarioId, to_jsonable
from ..engines.queue import Analysis, run

router = APIRouter()


@lru_cache(maxsize=32)
def get_analysis(scenario: str, threshold: float | None = None) -> Analysis:
    try:
        sid = ScenarioId(scenario)
    except ValueError:
        raise HTTPException(404, f"Unknown scenario '{scenario}'")
    return run(generate(sid), threshold_value=threshold)


def _meta() -> dict[str, Any]:
    return {"synthetic_notice": SYNTHETIC_NOTICE, "scoring_notice": SCORING_NOTICE}


@router.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", **_meta()}


@router.get("/scenarios")
def scenarios() -> dict[str, Any]:
    return {
        "scenarios": [
            {"id": s.value, **SCENARIO_META[s]} for s in ScenarioId
        ],
        "default": ScenarioId.COORDINATED.value,
        "threshold": SETTINGS.threshold,
        "bands": band_table(),
        **_meta(),
    }


@router.get("/summary")
def summary(scenario: str = ScenarioId.COORDINATED.value,
            threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    return {**a.summary(), **_meta()}


@router.get("/accounts")
def accounts(scenario: str = ScenarioId.COORDINATED.value,
             threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    rows = []
    for aid, f in a.features.items():
        ac = a.coordination.accounts[aid]
        sig = a.threshold.account_signals.get(aid)
        rows.append({
            **f.to_dict(),
            "individual_risk": a.individual[aid].score,
            "individual_band": a.individual[aid].band,
            "threshold_signal": round(sig.signal, 1) if sig else 0.0,
            "in_window": bool(sig and sig.in_window),
            "coordination_risk": round(ac.score, 1),
            "coordination_band": ac.band,
            "cluster_id": ac.cluster_id,
            "related_accounts": len(ac.related_accounts),
        })
    rows.sort(key=lambda r: r["account_id"])
    return {"accounts": rows, **_meta()}


@router.get("/returns")
def returns(scenario: str = ScenarioId.COORDINATED.value,
            threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    return {"returns": [r.to_dict() for r in a.queue], **_meta()}


@router.get("/investigation-queue")
def investigation_queue(scenario: str = ScenarioId.COORDINATED.value,
                        limit: int = Query(25, ge=1, le=500),
                        threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    return {
        "queue": [r.to_dict() for r in a.queue[:limit]],
        "total": len(a.queue),
        "recommended_action": "PRIORITISE FOR REVIEW",
        "human_in_the_loop": ("RefundShield prioritises cases for investigation. "
                              "It does not automatically deny refunds."),
        **_meta(),
    }


@router.get("/threshold-analysis")
def threshold_analysis(scenario: str = ScenarioId.COORDINATED.value,
                       threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    return {**a.threshold.to_dict(), **_meta()}


@router.get("/clusters")
def clusters(scenario: str = ScenarioId.COORDINATED.value,
             threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    out = []
    for c in a.clusters:
        cc = a.coordination.clusters[c.cluster_id]
        out.append({**c.to_dict(), "coordination": cc.to_dict()})
    out.sort(key=lambda c: -c["coordination"]["coordination_risk"])
    return {"clusters": out, **_meta()}


@router.get("/clusters/{cluster_id}")
def cluster_detail(cluster_id: str,
                   scenario: str = ScenarioId.COORDINATED.value,
                   threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    cmap = a.cluster_map
    if cluster_id not in cmap:
        raise HTTPException(404, f"Unknown cluster '{cluster_id}'")
    c = cmap[cluster_id]
    members = [{
        "account_id": aid,
        "return_rate_pct": round(a.features[aid].return_rate * 100, 1),
        "individual_risk": a.individual[aid].score,
        "individual_band": a.individual[aid].band,
        "threshold_signal": round(a.threshold.account_signals[aid].signal, 1),
        "in_window": a.threshold.account_signals[aid].in_window,
    } for aid in c.account_ids]
    return {
        **c.to_dict(),
        "coordination": a.coordination.clusters[cluster_id].to_dict(),
        "members": members,
        "explanation": a.explain_cluster(cluster_id).to_dict(),
        **_meta(),
    }


@router.get("/network/{account_id}")
def network(account_id: str,
            scenario: str = ScenarioId.COORDINATED.value,
            threshold: float | None = Query(None, ge=0.01, le=0.9),
            relationship: str = Query("all")) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    if account_id not in a.features:
        raise HTTPException(404, f"Unknown account '{account_id}'")
    ac = a.coordination.accounts[account_id]
    scope = set(ac.related_accounts) | {account_id}

    edges = [e for e in a.graph.edges
             if e.source in scope or e.target in scope]
    links = [e for e in a.graph.account_links
             if e.source in scope and e.target in scope]
    if relationship != "all":
        edges = [e for e in edges if e.kind == relationship]
        links = [e for e in links if e.kind == relationship]
    keep = scope | {e.target for e in edges} | {e.source for e in edges}
    nodes = [n for n in a.graph.nodes if n.id in keep]
    return {
        "focus": account_id,
        "cluster_id": ac.cluster_id,
        "related_accounts": ac.related_accounts,
        "nodes": [n.to_dict() for n in nodes],
        "edges": [e.to_dict() for e in edges],
        "account_links": [e.to_dict() for e in links],
        "caveat": ("Connections provide context. Behavioural evidence is required to "
                   "strengthen investigation priority."),
        **_meta(),
    }


@router.get("/coordination/{account_id}")
def coordination(account_id: str,
                 scenario: str = ScenarioId.COORDINATED.value,
                 threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    if account_id not in a.coordination.accounts:
        raise HTTPException(404, f"Unknown account '{account_id}'")
    return {**a.coordination.accounts[account_id].to_dict(),
            "individual": a.individual[account_id].to_dict(),
            **_meta()}


@router.get("/explanations/{account_id}")
def explanation(account_id: str,
                scenario: str = ScenarioId.COORDINATED.value,
                threshold: float | None = Query(None, ge=0.01, le=0.9)) -> dict[str, Any]:
    a = get_analysis(scenario, threshold)
    if account_id not in a.features:
        raise HTTPException(404, f"Unknown account '{account_id}'")
    return {**a.explain_account(account_id).to_dict(), **_meta()}


@router.get("/demo/hero")
def demo_hero() -> dict[str, Any]:
    """Everything the live demo needs for the coordinated case, in one call."""
    a = get_analysis(ScenarioId.COORDINATED.value)
    best = max(a.coordination.clusters.values(), key=lambda c: c.breakdown.score)
    c = a.cluster_map[best.cluster_id]
    return {
        "scenario": ScenarioId.COORDINATED.value,
        "cluster": {**c.to_dict(), "coordination": best.to_dict()},
        "members": [{
            "account_id": aid,
            "return_rate_pct": round(a.features[aid].return_rate * 100, 1),
            "individual_risk": a.individual[aid].score,
            "individual_band": a.individual[aid].band,
            "threshold_signal": round(a.threshold.account_signals[aid].signal, 1),
        } for aid in c.account_ids],
        "threshold": a.threshold.to_dict(),
        "explanation": a.explain_cluster(best.cluster_id).to_dict(),
        "queue_top": [r.to_dict() for r in a.queue[:5]],
        **_meta(),
    }
