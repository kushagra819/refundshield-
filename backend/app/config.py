"""RefundShield — central configuration.

Every tunable number in the prototype lives here, so the scoring logic can be
inspected and adjusted in one place rather than hunting through the engines.

IMPORTANT: these are TRANSPARENT PROTOTYPE PARAMETERS chosen to demonstrate a
decision workflow on synthetic data. They are not fitted, trained or validated
against labelled fraud outcomes.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# --------------------------------------------------------------------------
# Global disclosure strings (surfaced in the API and the UI)
# --------------------------------------------------------------------------
SYNTHETIC_NOTICE = "Synthetic demonstration environment — no real customer data."
SCORING_NOTICE = "Prototype scoring logic — synthetic demonstration, not a validated fraud probability."

# --------------------------------------------------------------------------
# Seller policy
# --------------------------------------------------------------------------
DEFAULT_RETURN_RATE_THRESHOLD = 0.20  # 20% — illustrative seller policy threshold
BUNCHING_WINDOW_PP = 0.02             # look at [threshold-2pp, threshold)
MIN_ORDERS_FOR_RATE = 5               # below this an account's rate is too noisy to score

# --------------------------------------------------------------------------
# Risk bands (shared by every score in the product)
# --------------------------------------------------------------------------
# (lower bound inclusive, upper bound EXCLUSIVE, label, display range).
# The bounds must be exclusive-above and contiguous: an earlier version used
# inclusive integer pairs, which left 29-30, 59-60 and 79-80 belonging to no
# band at all, so a score of 79.9 silently fell through and was labelled LOW.
BANDS: list[tuple[float, float, str, str]] = [
    (0.0, 30.0, "LOW", "0-29"),
    (30.0, 60.0, "MODERATE", "30-59"),
    (60.0, 80.0, "HIGH", "60-79"),
    (80.0, 100.01, "VERY HIGH", "80-100"),
]


def band_for(score: float) -> str:
    """Map a 0-100 score onto its band label. Total over [0, 100]."""
    s = max(0.0, min(100.0, float(score)))
    for lo, hi, label, _ in BANDS:
        if lo <= s < hi:
            return label
    return "VERY HIGH"


def band_table() -> list[dict[str, str]]:
    """The band definitions, for display in the UI."""
    return [{"label": label, "range": disp} for _, _, label, disp in BANDS]


@dataclass(frozen=True)
class IndividualRiskWeights:
    """Points contributed by each individual-behaviour rule (additive, capped at 100).

    Deliberate design note: return rate BELOW the seller threshold contributes only
    a modest number of points. A ring member sitting at 18.8% must score LOW
    individually — that is the entire premise of CX0507. Crossing the threshold is
    what makes the rate itself a strong individual signal.
    """
    rate_below_threshold_max: float = 12.0   # max points while still under threshold
    rate_above_threshold_max: float = 22.0   # additional points once above it
    # a fixed jump for crossing the seller's own policy line lives in
    # individual_risk.THRESHOLD_CROSSED_BONUS (8.0)
    repeated_empty_box: float = 14.0         # >= 2 empty-box claims
    repeated_damage: float = 12.0            # >= 3 damaged-item claims
    claim_type_concentration: float = 10.0   # one claim type dominates
    high_value_return_ratio: float = 10.0    # returns skew to high-value orders
    recent_frequency_spike: float = 12.0     # recent returns far above own baseline
    young_account_activity: float = 8.0      # new account, already returning
    behaviour_change: float = 8.0            # return rate accelerating


@dataclass(frozen=True)
class ThresholdEvasionParams:
    """Parameters for the population-level bunching estimator.

    Established concept: behavioural bunching around decision thresholds
    (widely used in public economics to detect responses to policy kinks).
    Our adaptation: treat near-threshold bunching as a return-fraud evasion
    signal, gated so that proximity alone never scores highly.
    """
    bin_width_pp: float = 0.01          # 1 percentage-point histogram bins
    rate_domain_max: float = 0.40       # histogram covers 0-40%
    counterfactual_degree: int = 3      # polynomial degree for the counterfactual fit
    exclusion_above_pp: float = 0.02    # also exclude just-above-threshold bins from the fit
    gate_full_at_excess: float = 2.0    # excess-mass ratio at which the gate reaches 1.0
    gate_floor: float = 0.35            # proximity alone can never exceed this share
    proximity_weight: float = 0.60
    tightness_weight: float = 0.25
    flattening_weight: float = 0.15


@dataclass(frozen=True)
class NetworkParams:
    """Cluster-level relational evidence parameters.

    The component weights sum to 1.0 and NO single component exceeds 0.30. That
    is a deliberate structural guarantee, not a tuning accident: it makes it
    arithmetically impossible for one relationship type — a shared device, a
    shared address — to push network evidence past 30/100 on its own.
    """
    timing_window_days: int = 6         # "similar claim timing" window
    min_cluster_size: int = 2
    # ring-indicative feature weights (sum to 1.0, each <= 0.30)
    w_link_strength: float = 0.30
    w_category_overlap: float = 0.18
    w_claim_timing: float = 0.20
    w_claim_homogeneity: float = 0.12
    w_rate_tightness: float = 0.20


@dataclass(frozen=True)
class EdgeWeights:
    """Base strength of each relationship type (prototype design weights).

    These are NOT validated fraud probabilities. Each is scaled by how RARE the
    shared entity is across the population (an inverse-frequency weight), so a
    device shared by 3 of 100 accounts counts for far more than an address
    shared by 40 — which is how an office or a delivery locker stops dominating.
    """
    shared_device: float = 0.40         # HIGH relational evidence
    shared_address: float = 0.25        # MODERATE relational evidence
    category_overlap: float = 0.12      # WEAK/MODERATE — corroborating only
    claim_timing: float = 0.18          # MODERATE — corroborating only
    behavioural_similarity: float = 0.15  # MODERATE — corroborating only

    # Structural links (device/address) can create a cluster on their own.
    # Corroborating links cannot: they only add weight to a pair, unless at
    # least two of them are independently strong.
    min_edge_weight: float = 0.20
    corroborating_only_min: float = 0.42   # of a 0.45 maximum
    corroborating_strong_at: float = 0.80


@dataclass(frozen=True)
class BenignParams:
    """Suppressors that separate legitimate households from coordinated rings.

    A household shares an address and often a device, but it buys broadly, has
    co-existed for a long time, returns at ordinary rates and claims at random
    times. Each of these pushes the benign factor up, which pulls coordination
    risk down without hiding the fact that network overlap exists.
    """
    broad_categories_per_member: float = 4.0   # at/above this looks like ordinary shopping
    long_shared_lifespan_days: float = 400.0   # at/above this looks like a real household
    dispersed_timing_days: float = 60.0        # at/above this the claims are not a burst
    min_factor: float = 0.20                   # strongest possible suppression
    max_factor: float = 1.00

    # Suppression is the MINIMUM of the indicators, not their average: a cluster
    # is treated as benign only to the extent of its WEAKEST benign indicator.
    # A real household looks ordinary on every axis at once. A ring that buys
    # broadly but claims in a six-day burst is not a household, and averaging
    # would have let it hide behind its one ordinary-looking trait.


@dataclass(frozen=True)
class CoordinationWeights:
    """How the three evidence streams combine into coordination risk."""
    network: float = 0.45
    threshold: float = 0.40
    individual: float = 0.15


# Investigation-priority bands (prototype triage labels, not severity claims).
PRIORITY_BANDS: list[tuple[float, str]] = [
    (60.0, "URGENT"), (45.0, "HIGH"), (25.0, "MEDIUM"), (0.0, "LOW"),
]


def priority_for(score: float) -> str:
    for floor, label in PRIORITY_BANDS:
        if score >= floor:
            return label
    return "LOW"


# Evidence-strength labels (prototype categories, not probabilities).
def evidence_strength(value: float) -> str:
    """Map a normalised 0-1 evidence component onto LOW / MODERATE / HIGH."""
    v = max(0.0, min(1.0, float(value)))
    return "HIGH" if v >= 0.60 else "MODERATE" if v >= 0.30 else "LOW"


@dataclass(frozen=True)
class QueueWeights:
    """How a return request earns its place in the investigation queue."""
    coordination: float = 0.55
    individual: float = 0.30
    claim_severity: float = 0.15


# Severity of each claim type for queue ordering (0-1). Empty box is the most
# expensive to verify after the fact, so it ranks highest.
CLAIM_SEVERITY: dict[str, float] = {
    "Empty box": 1.00,
    "Missing parts": 0.75,
    "Damaged item": 0.70,
    "Wrong item": 0.45,
    "Item not as described": 0.35,
    "Changed mind": 0.10,
}

PRODUCT_CATEGORIES: list[str] = [
    "Electronics",
    "Small Appliances",
    "Fashion",
    "Beauty",
    "Home & Kitchen",
    "Accessories",
]

CLAIM_TYPES: list[str] = list(CLAIM_SEVERITY.keys())


@dataclass(frozen=True)
class Settings:
    threshold: float = DEFAULT_RETURN_RATE_THRESHOLD
    bunching_window: float = BUNCHING_WINDOW_PP
    individual: IndividualRiskWeights = field(default_factory=IndividualRiskWeights)
    evasion: ThresholdEvasionParams = field(default_factory=ThresholdEvasionParams)
    network: NetworkParams = field(default_factory=NetworkParams)
    benign: BenignParams = field(default_factory=BenignParams)
    coordination: CoordinationWeights = field(default_factory=CoordinationWeights)
    queue: QueueWeights = field(default_factory=QueueWeights)
    edges: EdgeWeights = field(default_factory=EdgeWeights)


SETTINGS = Settings()
