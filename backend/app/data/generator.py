"""RefundShield — synthetic data generator.

Builds one complete, deterministic synthetic world per scenario.

DESIGN NOTE — why every scenario shares one base population
-----------------------------------------------------------
A fraud ring only matters because it hides inside an ordinary customer base. If
Scenario 4 contained nothing but the five ring accounts there would be no
distribution for them to bunch against, and the threshold-evasion signal would
be meaningless. So all four scenarios render the SAME 100-account population,
and each scenario overwrites a handful of those accounts with its cohort:

    normal       -> base population only
    household    -> 4 accounts become a genuine shared household
    isolated     -> 1 account becomes a repeat abuser
    coordinated  -> 5 accounts become the ring (the hero case)

Account count therefore stays at exactly 100 in every scenario, and the ring is
literally hiding among real customers.

All data is synthetic. Identifiers are fake and carry no personal information.
"""
from __future__ import annotations

import math
import random
from datetime import date, timedelta

import numpy as np

from ..config import CLAIM_TYPES, PRODUCT_CATEGORIES
from ..domain.models import (
    Account,
    Address,
    AddressType,
    Cohort,
    Dataset,
    Device,
    Order,
    ReturnRequest,
    ScenarioId,
)

# --------------------------------------------------------------------------
# World constants — fixed so every run and every demo is byte-identical
# --------------------------------------------------------------------------
SEED = 20260916
TODAY = date(2026, 9, 13)
N_ACCOUNTS = 100
N_DEVICES = 74
N_ADDRESSES = 68

CITIES = ["Mumbai", "Thane", "Navi Mumbai", "Kalyan", "Palghar", "Vasai"]

# Base population return-rate distribution: lognormal, centred near 9%.
# Chosen so that the band just below a 20% threshold is naturally SPARSE —
# any excess mass there in Scenario 4 is therefore attributable to the ring
# rather than to the shape of the base distribution.
BASE_RATE_MU = math.log(0.09)
BASE_RATE_SIGMA = 0.45
BASE_RATE_CLIP = (0.005, 0.42)

# --------------------------------------------------------------------------
# Cohort slots — which of the 100 accounts each scenario overwrites
# --------------------------------------------------------------------------
RING_ACCOUNTS = ["ACC-1032", "ACC-1047", "ACC-1051", "ACC-1062", "ACC-1078"]
HOUSEHOLD_ACCOUNTS = ["ACC-1014", "ACC-1015", "ACC-1016", "ACC-1017"]
ISOLATED_ACCOUNT = "ACC-1073"

RING_DEVICE = "DEV-017"
RING_ADDRESS = "ADDR-009"
HOUSEHOLD_DEVICE = "DEV-004"
HOUSEHOLD_ADDRESS = "ADDR-002"

# (account, orders, returns) chosen so the realised rate rounds to exactly the
# figure used throughout the RefundShield pitch deck.
#   7/38 = 18.42%   3/16 = 18.75%   4/21 = 19.05%   8/43 = 18.60%   9/47 = 19.15%
RING_PROFILE: list[tuple[str, int, int]] = [
    ("ACC-1032", 38, 7),   # 18.4%
    ("ACC-1047", 16, 3),   # 18.8%
    ("ACC-1051", 21, 4),   # 19.0%
    ("ACC-1062", 43, 8),   # 18.6%
    ("ACC-1078", 47, 9),   # 19.1%
]
# Three of the five share the device; three share the address (different trios,
# so no single attribute links the whole group — that is the realistic case).
RING_DEVICE_MEMBERS = {"ACC-1032", "ACC-1047", "ACC-1062"}
RING_ADDRESS_MEMBERS = {"ACC-1047", "ACC-1051", "ACC-1078"}
RING_CATEGORIES = ["Electronics", "Small Appliances"]
# A ring disciplined enough to manage return rates to 18.4% would not also lead
# with the single most-scrutinised claim reason. It uses mundane reasons, which
# is both more realistic and the reason its members score LOW individually.
RING_CLAIM_TYPES = ["Item not as described", "Damaged item", "Wrong item"]
RING_CLAIM_WINDOW_DAYS = 6

HOUSEHOLD_CATEGORIES = ["Fashion", "Beauty", "Home & Kitchen", "Accessories", "Electronics"]

# Entities held back from the base population. Without this the generator can
# hand a cohort's "private" device to an unrelated shopper, which would splice
# innocent accounts into a cohort's cluster and muddy every scenario.
RESERVED_DEVICES: set[str] = (
    {RING_DEVICE, HOUSEHOLD_DEVICE, "DEV-070"}
    | {f"DEV-{40 + n:03d}" for n in range(4)}      # household members' own phones
    | {f"DEV-{50 + n:03d}" for n in range(5)}      # ring members' own phones
)
RESERVED_ADDRESSES: set[str] = (
    {RING_ADDRESS, HOUSEHOLD_ADDRESS, "ADDR-061"}
    | {f"ADDR-{20 + n:03d}" for n in range(5)}     # ring members' own addresses
)
HOUSEHOLD_CLAIM_TYPES = ["Changed mind", "Item not as described", "Wrong item", "Damaged item"]


def _acc_id(i: int) -> str:
    return f"ACC-{1000 + i:04d}"


class _Ids:
    """Monotonic identifier allocators, so IDs are stable and readable."""

    def __init__(self) -> None:
        self._order = 5000
        self._ret = 7000

    def order(self) -> str:
        self._order += 1
        return f"ORD-{self._order}"

    def ret(self) -> str:
        self._ret += 1
        return f"RET-{self._ret}"


def _build_static(rng: random.Random) -> tuple[list[Device], list[Address]]:
    devices = [
        Device(device_id=f"DEV-{i:03d}",
               form_factor=rng.choices(["mobile", "desktop", "tablet"], weights=[72, 22, 6])[0])
        for i in range(1, N_DEVICES + 1)
    ]
    addresses = []
    for i in range(1, N_ADDRESSES + 1):
        kind = rng.choices(
            [AddressType.RESIDENTIAL, AddressType.PG_HOSTEL, AddressType.COMMERCIAL],
            weights=[80, 13, 7],
        )[0]
        addresses.append(
            Address(
                address_id=f"ADDR-{i:03d}",
                address_type=kind,
                city=rng.choice(CITIES),
                pincode=f"4{rng.randint(0, 9)}{rng.randint(0, 9)}{rng.randint(0, 9)}{rng.randint(1, 9)}{rng.randint(0, 9)}",
            )
        )
    return devices, addresses


def _order_value(rng: random.Random, category: str) -> float:
    """Category-plausible order values in INR."""
    lo, hi = {
        "Electronics": (2400, 34000),
        "Small Appliances": (1200, 14000),
        "Fashion": (500, 5200),
        "Beauty": (300, 3200),
        "Home & Kitchen": (450, 7800),
        "Accessories": (350, 4600),
    }[category]
    return float(round(rng.uniform(lo, hi), -1))


def _make_orders(
    ids: _Ids,
    rng: random.Random,
    account: Account,
    n_orders: int,
    span_days: int,
    categories: list[str] | None = None,
) -> list[Order]:
    cats = categories or PRODUCT_CATEGORIES
    orders: list[Order] = []
    for _ in range(n_orders):
        placed = TODAY - timedelta(days=rng.randint(4, max(5, span_days)))
        category = rng.choice(cats)
        orders.append(
            Order(
                order_id=ids.order(),
                account_id=account.account_id,
                placed_on=placed,
                category=category,
                value_inr=_order_value(rng, category),
                device_id=rng.choice(account.device_ids),
            )
        )
    orders.sort(key=lambda o: o.placed_on)
    return orders


def _make_return(
    ids: _Ids,
    rng: random.Random,
    order: Order,
    claim_type: str,
    filed_on: date | None = None,
    full_refund: bool = True,
) -> ReturnRequest:
    delivered = order.placed_on + timedelta(days=rng.randint(2, 6))
    if filed_on is None:
        filed_on = delivered + timedelta(days=rng.randint(1, 12))
    if filed_on > TODAY:
        filed_on = TODAY
    refund = order.value_inr if full_refund else round(order.value_inr * rng.uniform(0.4, 0.9), -1)
    return ReturnRequest(
        return_id=ids.ret(),
        order_id=order.order_id,
        account_id=order.account_id,
        claim_type=claim_type,
        refund_inr=float(refund),
        filed_on=filed_on,
        days_since_delivery=max(0, (filed_on - delivered).days),
    )


# --------------------------------------------------------------------------
# Base population
# --------------------------------------------------------------------------
def _base_population(ids: _Ids, rng: random.Random, nprng: np.random.Generator,
                     devices: list[Device], addresses: list[Address]):
    accounts: list[Account] = []
    orders: list[Order] = []
    returns: list[ReturnRequest] = []

    free_devices = [d for d in devices if d.device_id not in RESERVED_DEVICES]
    free_addresses = [a for a in addresses if a.address_id not in RESERVED_ADDRESSES]

    for i in range(1, N_ACCOUNTS + 1):
        aid = _acc_id(i)
        age_days = rng.randint(70, 1080)
        n_devices = 1 if rng.random() < 0.82 else 2
        acc = Account(
            account_id=aid,
            created_on=TODAY - timedelta(days=age_days),
            address_id=rng.choice(free_addresses).address_id,
            device_ids=[rng.choice(free_devices).device_id for _ in range(n_devices)],
            cohort=Cohort.NORMAL,
        )
        # engaged customers place more orders; casual shoppers place few
        n_orders = int(np.clip(nprng.gamma(shape=3.0, scale=3.9), 3, 38))
        acc_orders = _make_orders(ids, rng, acc, n_orders, span_days=min(age_days, 720))

        target_rate = float(np.clip(
            nprng.lognormal(BASE_RATE_MU, BASE_RATE_SIGMA), *BASE_RATE_CLIP))
        n_returns = int(round(target_rate * n_orders))
        n_returns = max(0, min(n_returns, n_orders))

        for order in rng.sample(acc_orders, n_returns):
            claim = rng.choices(
                CLAIM_TYPES,
                weights=[4, 7, 16, 14, 22, 37],  # "Changed mind" dominates for honest shoppers
            )[0]
            returns.append(_make_return(ids, rng, order, claim,
                                        full_refund=rng.random() < 0.8))

        accounts.append(acc)
        orders.extend(acc_orders)

    return accounts, orders, returns


# --------------------------------------------------------------------------
# Cohort injectors — each replaces a few base accounts in place
# --------------------------------------------------------------------------
def _strip(account_ids: set[str], orders: list[Order], returns: list[ReturnRequest]):
    """Remove all orders/returns belonging to the given accounts."""
    orders[:] = [o for o in orders if o.account_id not in account_ids]
    returns[:] = [r for r in returns if r.account_id not in account_ids]


def _inject_household(ids: _Ids, rng: random.Random, accounts: list[Account],
                      orders: list[Order], returns: list[ReturnRequest]) -> None:
    """Four people in one home: shared address, shared tablet, ordinary behaviour.

    Deliberately given every RELATIONAL signal a ring would have (same address,
    same device) and none of the BEHAVIOURAL ones (broad categories, long shared
    history, ordinary return rates, scattered claim timing, mixed claim types).
    """
    members = set(HOUSEHOLD_ACCOUNTS)
    _strip(members, orders, returns)
    index = {a.account_id: a for a in accounts}

    for n, aid in enumerate(HOUSEHOLD_ACCOUNTS):
        acc = index[aid]
        acc.cohort = Cohort.HOUSEHOLD
        acc.address_id = HOUSEHOLD_ADDRESS
        # the household tablet, plus each person's own phone
        acc.device_ids = [HOUSEHOLD_DEVICE, f"DEV-{40 + n:03d}"]
        acc.created_on = TODAY - timedelta(days=rng.randint(520, 900))  # long co-existence

        n_orders = rng.randint(11, 24)
        # each member shops across a broad, individual mix of categories
        own_cats = rng.sample(HOUSEHOLD_CATEGORIES, k=rng.randint(4, 5))
        acc_orders = _make_orders(ids, rng, acc, n_orders, span_days=700, categories=own_cats)

        rate = rng.uniform(0.06, 0.13)          # ordinary, well below threshold
        n_returns = max(1, int(round(rate * n_orders)))
        for order in rng.sample(acc_orders, n_returns):
            claim = rng.choice(HOUSEHOLD_CLAIM_TYPES)
            returns.append(_make_return(ids, rng, order, claim,
                                        full_refund=rng.random() < 0.75))
        orders.extend(acc_orders)


def _inject_isolated(ids: _Ids, rng: random.Random, accounts: list[Account],
                     orders: list[Order], returns: list[ReturnRequest]) -> None:
    """One account abusing returns on its own — no shared entities at all."""
    _strip({ISOLATED_ACCOUNT}, orders, returns)
    index = {a.account_id: a for a in accounts}
    acc = index[ISOLATED_ACCOUNT]
    acc.cohort = Cohort.ISOLATED_ABUSE
    acc.address_id = "ADDR-061"                  # its own address
    acc.device_ids = ["DEV-070"]                 # its own device
    acc.created_on = TODAY - timedelta(days=165)

    n_orders = 29
    acc_orders = _make_orders(ids, rng, acc, n_orders, span_days=160,
                              categories=["Electronics", "Small Appliances", "Home & Kitchen"])
    # skews its returns onto the most expensive orders it has placed
    acc_orders.sort(key=lambda o: o.value_inr, reverse=True)
    n_returns = 10                                # 10/29 = 34.5%, clearly above threshold
    for k, order in enumerate(acc_orders[:n_returns]):
        claim = "Damaged item" if k % 3 else "Empty box"
        # recent burst: most claims filed in the last few weeks
        filed = TODAY - timedelta(days=rng.randint(1, 26))
        returns.append(_make_return(ids, rng, order, claim, filed_on=filed))
    orders.extend(acc_orders)


def _inject_ring(ids: _Ids, rng: random.Random, accounts: list[Account],
                 orders: list[Order], returns: list[ReturnRequest]) -> None:
    """The hero case: five accounts each parked just under the threshold."""
    members = set(RING_ACCOUNTS)
    _strip(members, orders, returns)
    index = {a.account_id: a for a in accounts}

    # all five onboarded within a short window — a batch, not organic growth
    batch_start = rng.randint(150, 175)
    # every member files its claims inside one tight window
    window_end = rng.randint(2, 4)

    for n, (aid, n_orders, n_returns) in enumerate(RING_PROFILE):
        acc = index[aid]
        acc.cohort = Cohort.RING
        acc.created_on = TODAY - timedelta(days=batch_start - n * rng.randint(4, 11))
        acc.address_id = RING_ADDRESS if aid in RING_ADDRESS_MEMBERS else f"ADDR-{20 + n:03d}"
        acc.device_ids = ([RING_DEVICE] if aid in RING_DEVICE_MEMBERS
                          else [f"DEV-{50 + n:03d}"])

        acc_orders = _make_orders(ids, rng, acc, n_orders, span_days=140,
                                  categories=RING_CATEGORIES)
        # returns land on the higher-value orders
        acc_orders.sort(key=lambda o: o.value_inr, reverse=True)
        picked = acc_orders[: n_returns + 4]
        rng.shuffle(picked)
        for k, order in enumerate(picked[:n_returns]):
            claim = RING_CLAIM_TYPES[k % len(RING_CLAIM_TYPES)]
            filed = TODAY - timedelta(days=rng.randint(window_end, window_end + RING_CLAIM_WINDOW_DAYS))
            returns.append(_make_return(ids, rng, order, claim, filed_on=filed))
        orders.extend(acc_orders)


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------
def generate(scenario: ScenarioId) -> Dataset:
    """Build the complete synthetic world for one scenario (deterministic)."""
    rng = random.Random(SEED)
    nprng = np.random.default_rng(SEED)

    devices, addresses = _build_static(rng)
    ids = _Ids()
    accounts, orders, returns = _base_population(ids, rng, nprng, devices, addresses)

    if scenario is ScenarioId.HOUSEHOLD:
        _inject_household(ids, rng, accounts, orders, returns)
    elif scenario is ScenarioId.ISOLATED:
        _inject_isolated(ids, rng, accounts, orders, returns)
    elif scenario is ScenarioId.COORDINATED:
        _inject_ring(ids, rng, accounts, orders, returns)

    orders.sort(key=lambda o: o.order_id)
    returns.sort(key=lambda r: r.return_id)

    return Dataset(
        scenario=scenario,
        accounts=accounts,
        orders=orders,
        returns=returns,
        devices=devices,
        addresses=addresses,
        generated_on=TODAY,
    )


def generate_all() -> dict[ScenarioId, Dataset]:
    return {s: generate(s) for s in ScenarioId}
