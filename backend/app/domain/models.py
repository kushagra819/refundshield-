"""RefundShield — domain model.

Plain dataclasses describing the entities a D2C seller already has in its order
and returns systems. Everything here is synthetic; identifiers are deliberately
fake (ACC-/ORD-/RET-/DEV-/ADDR-) and carry no personal information.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import date
from enum import Enum
from typing import Any


class Cohort(str, Enum):
    """Which synthetic population an account belongs to.

    Used only to generate and explain the demo; the engines never read it, so a
    cohort label can never leak into a risk score.
    """
    NORMAL = "normal"
    HOUSEHOLD = "household"
    ISOLATED_ABUSE = "isolated_abuse"
    RING = "ring"


class AddressType(str, Enum):
    RESIDENTIAL = "residential"
    PG_HOSTEL = "pg_hostel"
    COMMERCIAL = "commercial"


class ScenarioId(str, Enum):
    NORMAL = "normal"
    HOUSEHOLD = "household"
    ISOLATED = "isolated"
    COORDINATED = "coordinated"


SCENARIO_META: dict[ScenarioId, dict[str, str]] = {
    ScenarioId.NORMAL: {
        "name": "Normal Customers",
        "summary": "Ordinary return behaviour with rates distributed naturally.",
        "expected": "Low / normal risk. No near-threshold concentration.",
    },
    ScenarioId.HOUSEHOLD: {
        "name": "Legitimate Shared Household",
        "summary": "Several accounts genuinely share an address and a device.",
        "expected": "Network overlap present, but coordination risk stays LOW — "
                    "shared attributes alone are not evidence of coordination.",
    },
    ScenarioId.ISOLATED: {
        "name": "Isolated Abuse",
        "summary": "One account repeatedly files suspicious high-value claims.",
        "expected": "High individual return risk, low network / coordination risk.",
    },
    ScenarioId.COORDINATED: {
        "name": "Coordinated Threshold Evasion",
        "summary": "Five accounts each sit just below the seller's return-rate threshold "
                   "while sharing a device, an address, product categories and claim timing.",
        "expected": "Low individual risk per account, HIGH coordination risk as a group.",
    },
}


@dataclass
class Address:
    address_id: str
    address_type: AddressType
    city: str
    pincode: str


@dataclass
class Device:
    device_id: str
    form_factor: str  # "mobile" | "desktop" | "tablet"


@dataclass
class Account:
    account_id: str
    created_on: date
    address_id: str
    device_ids: list[str] = field(default_factory=list)
    cohort: Cohort = Cohort.NORMAL

    @property
    def primary_device(self) -> str | None:
        return self.device_ids[0] if self.device_ids else None


@dataclass
class Order:
    order_id: str
    account_id: str
    placed_on: date
    category: str
    value_inr: float
    device_id: str


@dataclass
class ReturnRequest:
    return_id: str
    order_id: str
    account_id: str
    claim_type: str
    refund_inr: float
    filed_on: date
    days_since_delivery: int
    status: str = "Awaiting review"


@dataclass
class Dataset:
    """One complete synthetic world for a scenario."""
    scenario: ScenarioId
    accounts: list[Account]
    orders: list[Order]
    returns: list[ReturnRequest]
    devices: list[Device]
    addresses: list[Address]
    generated_on: date

    # -- convenience lookups ------------------------------------------------
    def account_index(self) -> dict[str, Account]:
        return {a.account_id: a for a in self.accounts}

    def order_index(self) -> dict[str, Order]:
        return {o.order_id: o for o in self.orders}

    def orders_by_account(self) -> dict[str, list[Order]]:
        out: dict[str, list[Order]] = {a.account_id: [] for a in self.accounts}
        for o in self.orders:
            out.setdefault(o.account_id, []).append(o)
        return out

    def returns_by_account(self) -> dict[str, list[ReturnRequest]]:
        out: dict[str, list[ReturnRequest]] = {a.account_id: [] for a in self.accounts}
        for r in self.returns:
            out.setdefault(r.account_id, []).append(r)
        return out

    def summary(self) -> dict[str, Any]:
        return {
            "scenario": self.scenario.value,
            "accounts": len(self.accounts),
            "orders": len(self.orders),
            "returns": len(self.returns),
            "devices": len(self.devices),
            "addresses": len(self.addresses),
        }


def to_jsonable(obj: Any) -> Any:
    """Recursively convert dataclasses/enums/dates into JSON-safe primitives."""
    if hasattr(obj, "__dataclass_fields__"):
        return {k: to_jsonable(v) for k, v in asdict(obj).items()}
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    return obj
