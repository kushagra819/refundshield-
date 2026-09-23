"""RefundShield — feature engineering.

Turns the raw order/return records into one feature row per account. This layer
does arithmetic only: it computes no scores and makes no judgements, so the
risk engines downstream can be swapped or retrained without touching it.

DESIGN NOTE — what deliberately is NOT here
-------------------------------------------
Claim *burst timing* is not an individual feature. One account filing three
claims in a week is unremarkable — people receive bad batches. Several
apparently unrelated accounts filing in the same week is the thing that matters,
and that is a property of a group, not of a person. Burst timing is therefore
measured in the coordination layer (Phase 4), not here.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

import pandas as pd

from ..config import MIN_ORDERS_FOR_RATE
from ..domain.models import Cohort, Dataset

SUSTAINED_WINDOW_DAYS = 120


@dataclass
class PopulationContext:
    """Seller-wide reference values an account is compared against."""
    as_of: date
    account_count: int
    order_count: int
    return_count: int
    overall_return_rate: float
    high_value_order_threshold: float       # 75th percentile of order value
    claim_type_baseline: dict[str, float]   # population share of each claim type

    def to_dict(self) -> dict[str, Any]:
        return {
            "as_of": self.as_of.isoformat(),
            "account_count": self.account_count,
            "order_count": self.order_count,
            "return_count": self.return_count,
            "overall_return_rate": round(self.overall_return_rate, 4),
            "high_value_order_threshold": round(self.high_value_order_threshold, 2),
            "claim_type_baseline": {k: round(v, 4) for k, v in self.claim_type_baseline.items()},
        }


@dataclass
class AccountFeatures:
    account_id: str
    cohort: Cohort                       # demo labelling only — never read by a scorer

    # volume and tenure
    account_age_days: int
    order_count: int
    return_count: int

    # rate
    return_rate: float
    rate_is_reliable: bool               # False when the account has too few orders

    # value
    order_value_total: float
    refund_value_total: float
    refund_value_share: float
    high_value_return_share: float       # share of returns on top-quartile orders

    # claim mix
    claim_type_counts: dict[str, int]
    dominant_claim_type: str | None
    claim_type_concentration: float
    empty_box_count: int
    empty_box_share: float
    damage_count: int
    damage_share: float

    # trajectory
    recent_rate: float                   # last 120 days
    prior_rate: float                    # the 120 days before that
    recent_orders: int
    prior_orders: int
    recent_return_span_days: int         # calendar spread of the recent-window claims
    rate_trajectory: float               # recent / prior (0.0 when not computable)
    trajectory_is_reliable: bool

    # relational context (used by later phases, computed once here)
    device_ids: list[str]
    address_id: str
    categories: list[str] = field(default_factory=list)
    first_order_on: date | None = None
    last_return_on: date | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "account_id": self.account_id,
            "cohort": self.cohort.value,
            "account_age_days": self.account_age_days,
            "order_count": self.order_count,
            "return_count": self.return_count,
            "return_rate": round(self.return_rate, 4),
            "return_rate_pct": round(self.return_rate * 100, 1),
            "rate_is_reliable": self.rate_is_reliable,
            "order_value_total": round(self.order_value_total, 2),
            "refund_value_total": round(self.refund_value_total, 2),
            "refund_value_share": round(self.refund_value_share, 4),
            "high_value_return_share": round(self.high_value_return_share, 4),
            "claim_type_counts": self.claim_type_counts,
            "dominant_claim_type": self.dominant_claim_type,
            "claim_type_concentration": round(self.claim_type_concentration, 4),
            "empty_box_count": self.empty_box_count,
            "empty_box_share": round(self.empty_box_share, 4),
            "damage_count": self.damage_count,
            "damage_share": round(self.damage_share, 4),
            "recent_rate": round(self.recent_rate, 4),
            "prior_rate": round(self.prior_rate, 4),
            "recent_return_span_days": self.recent_return_span_days,
            "rate_trajectory": round(self.rate_trajectory, 3),
            "trajectory_is_reliable": self.trajectory_is_reliable,
            "device_ids": self.device_ids,
            "address_id": self.address_id,
            "categories": self.categories,
            "first_order_on": self.first_order_on.isoformat() if self.first_order_on else None,
            "last_return_on": self.last_return_on.isoformat() if self.last_return_on else None,
        }


def _frames(ds: Dataset) -> tuple[pd.DataFrame, pd.DataFrame]:
    orders = pd.DataFrame(
        [
            {
                "order_id": o.order_id,
                "account_id": o.account_id,
                "placed_on": o.placed_on,
                "category": o.category,
                "value_inr": o.value_inr,
            }
            for o in ds.orders
        ]
    )
    returns = pd.DataFrame(
        [
            {
                "return_id": r.return_id,
                "order_id": r.order_id,
                "account_id": r.account_id,
                "claim_type": r.claim_type,
                "refund_inr": r.refund_inr,
                "filed_on": r.filed_on,
            }
            for r in ds.returns
        ]
    )
    return orders, returns


def build_population_context(ds: Dataset) -> PopulationContext:
    orders, returns = _frames(ds)
    claim_counts = Counter(returns["claim_type"]) if len(returns) else Counter()
    total_claims = max(1, sum(claim_counts.values()))
    return PopulationContext(
        as_of=ds.generated_on,
        account_count=len(ds.accounts),
        order_count=len(ds.orders),
        return_count=len(ds.returns),
        overall_return_rate=(len(ds.returns) / len(ds.orders)) if len(ds.orders) else 0.0,
        high_value_order_threshold=float(orders["value_inr"].quantile(0.75)),
        claim_type_baseline={k: v / total_claims for k, v in claim_counts.items()},
    )


def build_features(ds: Dataset) -> tuple[dict[str, AccountFeatures], PopulationContext]:
    """Compute one feature row per account."""
    ctx = build_population_context(ds)
    orders, returns = _frames(ds)
    as_of = ds.generated_on
    recent_cut = as_of - timedelta(days=SUSTAINED_WINDOW_DAYS)
    prior_cut = as_of - timedelta(days=2 * SUSTAINED_WINDOW_DAYS)

    order_value = dict(zip(orders["order_id"], orders["value_inr"]))
    by_order_acct = orders.groupby("account_id")
    by_ret_acct = returns.groupby("account_id") if len(returns) else None

    order_groups = {aid: g for aid, g in by_order_acct}
    return_groups = {aid: g for aid, g in by_ret_acct} if by_ret_acct is not None else {}

    out: dict[str, AccountFeatures] = {}
    for acc in ds.accounts:
        aid = acc.account_id
        og = order_groups.get(aid)
        rg = return_groups.get(aid)

        n_orders = 0 if og is None else int(len(og))
        n_returns = 0 if rg is None else int(len(rg))
        rate = (n_returns / n_orders) if n_orders else 0.0

        order_value_total = 0.0 if og is None else float(og["value_inr"].sum())
        refund_total = 0.0 if rg is None else float(rg["refund_inr"].sum())

        # claim mix
        counts = Counter() if rg is None else Counter(rg["claim_type"])
        dominant, dominant_n = (counts.most_common(1)[0] if counts else (None, 0))
        concentration = (dominant_n / n_returns) if n_returns else 0.0
        empty_box = int(counts.get("Empty box", 0))
        damage = int(counts.get("Damaged item", 0))

        # value skew: how many returns sit on top-quartile orders
        if rg is not None and n_returns:
            hv = sum(
                1 for oid in rg["order_id"]
                if order_value.get(oid, 0.0) >= ctx.high_value_order_threshold
            )
            high_value_share = hv / n_returns
        else:
            high_value_share = 0.0

        # trajectory: recent window vs the window before it
        if og is not None:
            recent_orders = int((og["placed_on"] >= recent_cut).sum())
            prior_orders = int(((og["placed_on"] >= prior_cut) & (og["placed_on"] < recent_cut)).sum())
        else:
            recent_orders = prior_orders = 0
        if rg is not None:
            recent_mask = rg["filed_on"] >= recent_cut
            recent_returns = int(recent_mask.sum())
            prior_returns = int(((rg["filed_on"] >= prior_cut) & (rg["filed_on"] < recent_cut)).sum())
            recent_dates = list(rg.loc[recent_mask, "filed_on"])
            recent_span = (max(recent_dates) - min(recent_dates)).days if len(recent_dates) > 1 else 0
        else:
            recent_returns = prior_returns = 0
            recent_span = 0

        recent_rate = (recent_returns / recent_orders) if recent_orders else 0.0
        prior_rate = (prior_returns / prior_orders) if prior_orders else 0.0
        trajectory_reliable = recent_orders >= 4 and prior_orders >= 4
        if trajectory_reliable and prior_rate > 0:
            trajectory = recent_rate / prior_rate
        elif trajectory_reliable and recent_rate > 0:
            trajectory = 99.0                      # went from nothing to something
        else:
            trajectory = 0.0

        out[aid] = AccountFeatures(
            account_id=aid,
            cohort=acc.cohort,
            account_age_days=(as_of - acc.created_on).days,
            order_count=n_orders,
            return_count=n_returns,
            return_rate=rate,
            rate_is_reliable=n_orders >= MIN_ORDERS_FOR_RATE,
            order_value_total=order_value_total,
            refund_value_total=refund_total,
            refund_value_share=(refund_total / order_value_total) if order_value_total else 0.0,
            high_value_return_share=high_value_share,
            claim_type_counts=dict(counts),
            dominant_claim_type=dominant,
            claim_type_concentration=concentration,
            empty_box_count=empty_box,
            empty_box_share=(empty_box / n_returns) if n_returns else 0.0,
            damage_count=damage,
            damage_share=(damage / n_returns) if n_returns else 0.0,
            recent_rate=recent_rate,
            prior_rate=prior_rate,
            recent_orders=recent_orders,
            prior_orders=prior_orders,
            recent_return_span_days=recent_span,
            rate_trajectory=trajectory,
            trajectory_is_reliable=trajectory_reliable,
            device_ids=list(acc.device_ids),
            address_id=acc.address_id,
            categories=sorted(set(og["category"])) if og is not None else [],
            first_order_on=(min(og["placed_on"]) if og is not None and n_orders else None),
            last_return_on=(max(rg["filed_on"]) if rg is not None and n_returns else None),
        )

    return out, ctx
