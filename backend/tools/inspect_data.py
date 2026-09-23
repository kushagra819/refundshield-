"""Phase 1 inspection report — prints the synthetic world so it can be eyeballed.

    python tools/inspect_data.py
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import DEFAULT_RETURN_RATE_THRESHOLD as THRESHOLD
from app.data.generator import HOUSEHOLD_ACCOUNTS, ISOLATED_ACCOUNT, RING_ACCOUNTS, generate
from app.domain.models import SCENARIO_META, ScenarioId


def rates(ds, min_orders: int = 1) -> dict[str, float]:
    orders = Counter(o.account_id for o in ds.orders)
    rets = Counter(r.account_id for r in ds.returns)
    return {a: rets[a] / orders[a] for a in orders if orders[a] >= min_orders}


def histogram(values: list[float], threshold: float, width: int = 54) -> None:
    bins = [0] * 40                       # 1pp bins over 0-40%
    for v in values:
        idx = min(39, int(v * 100))
        bins[idx] += 1
    peak = max(bins) or 1
    for i in range(0, 32):
        lo = i
        mark = ""
        if lo == int(threshold * 100):
            mark = "  <== THRESHOLD"
        elif int((threshold - 0.02) * 100) <= lo < int(threshold * 100):
            mark = "  <-- bunching window"
        bar = "#" * int(bins[i] / peak * width)
        print(f"  {lo:2d}-{lo+1:2d}%  {bins[i]:3d} |{bar}{mark}")


def main() -> None:
    print("=" * 74)
    print("REFUNDSHIELD — PHASE 1 SYNTHETIC DATA REPORT")
    print("Synthetic demonstration environment — no real customer data.")
    print("=" * 74)

    for scenario in ScenarioId:
        ds = generate(scenario)
        meta = SCENARIO_META[scenario]
        s = ds.summary()
        by_acct = rates(ds)
        overall = len(ds.returns) / len(ds.orders)

        print(f"\n\n### {meta['name'].upper()}  ({scenario.value})")
        print(f"    {meta['summary']}")
        print(f"    accounts={s['accounts']}  orders={s['orders']}  returns={s['returns']}"
              f"  devices={s['devices']}  addresses={s['addresses']}")
        print(f"    overall return rate: {overall*100:.1f}%")

        lo, hi = THRESHOLD - 0.02, THRESHOLD
        in_window = [a for a, r in by_acct.items() if lo <= r < hi]
        above = [a for a, r in by_acct.items() if r >= hi]
        print(f"    accounts in bunching window [{lo*100:.0f}%, {hi*100:.0f}%): {len(in_window)}")
        print(f"    accounts at/above threshold: {len(above)}")

        if scenario is ScenarioId.COORDINATED:
            print("\n    RING MEMBERS (individual view)")
            print("      account      orders  returns   rate    device     address")
            idx = ds.account_index()
            for aid in RING_ACCOUNTS:
                a = idx[aid]
                no = sum(1 for o in ds.orders if o.account_id == aid)
                nr = sum(1 for r in ds.returns if r.account_id == aid)
                print(f"      {aid}      {no:3d}     {nr:3d}   {nr/no*100:5.1f}%   "
                      f"{a.device_ids[0]}   {a.address_id}")
            ring = set(RING_ACCOUNTS)
            filed = sorted(r.filed_on for r in ds.returns if r.account_id in ring)
            claims = Counter(r.claim_type for r in ds.returns if r.account_id in ring)
            cats = Counter(o.category for o in ds.orders if o.account_id in ring)
            print(f"      claim window: {filed[0]} -> {filed[-1]}  ({(filed[-1]-filed[0]).days} days)")
            print(f"      claim types : {dict(claims)}")
            print(f"      categories  : {dict(cats)}")

        if scenario is ScenarioId.HOUSEHOLD:
            print("\n    HOUSEHOLD MEMBERS (shared entities, ordinary behaviour)")
            idx = ds.account_index()
            for aid in HOUSEHOLD_ACCOUNTS:
                a = idx[aid]
                no = sum(1 for o in ds.orders if o.account_id == aid)
                nr = sum(1 for r in ds.returns if r.account_id == aid)
                cats = {o.category for o in ds.orders if o.account_id == aid}
                print(f"      {aid}  orders={no:3d} returns={nr:2d} rate={nr/no*100:5.1f}%  "
                      f"addr={a.address_id}  categories={len(cats)}")
            hh = set(HOUSEHOLD_ACCOUNTS)
            filed = sorted(r.filed_on for r in ds.returns if r.account_id in hh)
            print(f"      claim spread: {(filed[-1]-filed[0]).days} days")

        if scenario is ScenarioId.ISOLATED:
            aid = ISOLATED_ACCOUNT
            no = sum(1 for o in ds.orders if o.account_id == aid)
            nr = sum(1 for r in ds.returns if r.account_id == aid)
            claims = Counter(r.claim_type for r in ds.returns if r.account_id == aid)
            print(f"\n    ABUSER {aid}: orders={no} returns={nr} rate={nr/no*100:.1f}%")
            print(f"      claim types: {dict(claims)}")

        print("\n    ACCOUNT RETURN-RATE DISTRIBUTION")
        histogram(list(by_acct.values()), THRESHOLD)

    print("\n" + "=" * 74)
    print("Phase 1 complete — data layer verified.")


if __name__ == "__main__":
    main()
