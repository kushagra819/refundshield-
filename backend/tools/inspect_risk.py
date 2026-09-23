"""Phase 2 inspection report — individual risk engine.

    python tools/inspect_risk.py
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import SETTINGS, band_for
from app.data.generator import HOUSEHOLD_ACCOUNTS, ISOLATED_ACCOUNT, RING_ACCOUNTS, generate
from app.engines.features import build_features
from app.engines.individual_risk import MAX_RAW_POINTS, RULES, score_all
from app.domain.models import ScenarioId


def show(aid: str, feats, risks, indent: str = "      ") -> None:
    f, r = feats[aid], risks[aid]
    print(f"{indent}{aid}   score {r.score:5.1f}  [{r.band}]   "
          f"rate={f.return_rate*100:5.1f}%  orders={f.order_count:3d} returns={f.return_count:2d}")
    for s in r.signals:
        print(f"{indent}   + {s.points:5.1f}  {s.label}")
        print(f"{indent}            {s.detail}")
    if not r.signals:
        print(f"{indent}   (no rules fired)")


def main() -> None:
    print("=" * 78)
    print("REFUNDSHIELD — PHASE 2: INDIVIDUAL RISK ENGINE")
    print("Prototype scoring logic — synthetic demonstration, not a validated model.")
    print(f"Seller threshold: {SETTINGS.threshold*100:.0f}%   "
          f"Rules: {len(RULES)}   Max raw points: {MAX_RAW_POINTS:.0f} (capped at 100)")
    print("=" * 78)

    for scenario in ScenarioId:
        ds = generate(scenario)
        feats, ctx = build_features(ds)
        risks = score_all(feats, ctx)
        scores = [r.score for r in risks.values()]
        bands = Counter(r.band for r in risks.values())

        print(f"\n\n### {scenario.value.upper()}")
        print(f"    population: mean={sum(scores)/len(scores):5.1f}  "
              f"max={max(scores):5.1f}  min={min(scores):4.1f}")
        print(f"    bands: " + "  ".join(f"{b}={bands.get(b,0)}"
              for b in ("LOW", "MODERATE", "HIGH", "VERY HIGH")))

        if scenario is ScenarioId.COORDINATED:
            print("\n    RING MEMBERS — must remain LOW individually")
            for aid in RING_ACCOUNTS:
                show(aid, feats, risks)
        if scenario is ScenarioId.ISOLATED:
            print("\n    ISOLATED ABUSER — must score HIGH")
            show(ISOLATED_ACCOUNT, feats, risks)
        if scenario is ScenarioId.HOUSEHOLD:
            print("\n    HOUSEHOLD MEMBERS — must remain LOW")
            for aid in HOUSEHOLD_ACCOUNTS:
                show(aid, feats, risks)
        if scenario is ScenarioId.NORMAL:
            top = sorted(risks.values(), key=lambda r: r.score, reverse=True)[:3]
            print("\n    HIGHEST-SCORING ORDINARY CUSTOMERS")
            for r in top:
                show(r.account_id, feats, risks)

    # explainability sample
    ds = generate(ScenarioId.COORDINATED)
    feats, ctx = build_features(ds)
    risks = score_all(feats, ctx)
    r = risks["ACC-1078"]
    print("\n\n### EXPLAINABILITY READOUT — ACC-1078 (always-visible factors)")
    for fac in r.factors:
        note = f"   ({fac.note})" if fac.note else ""
        print(f"    {fac.label:24s} {fac.value:>10s}{note}")

    print("\n" + "=" * 78)


if __name__ == "__main__":
    main()
