# RefundShield

**Detect the fraud ring that stays below the radar.**

Team: **The Anomaly Syndicate** · Problem Statement: **CX0507 — The Fraudulent Refund Loop** · Theme: FinTech & Digital Economy

> **Synthetic demonstration environment — no real customer data.**
> Every score in this prototype is produced by transparent, rule-based logic on
> synthetic data. Nothing here is a trained model, and no accuracy, precision,
> recall or fraud probability is claimed.

---

## MUSA CodeX 2026 — Round 2 submission

| | |
|---|---|
| **Demo video** | https://youtu.be/H8s1m3iL7uw (unlisted — anyone with the link can view) |
| **Repository** | https://github.com/kushagra819/refundshield- |
| **Live demo**  | https://refundshield.vercel.app |

The deployed site runs the **real engines**, not a mock: `/api/*` is served by the
FastAPI application in `backend/app` running as a Vercel Python function, and the
React build is served as static assets from the same origin. Every number on the
deployed site is computed at request time by the same code the test suite covers.

**Deployment layout**

```
vercel.json          build + routing:  /api/*  -> api/index.py  (FastAPI)
                                       /*      -> frontend/dist (React SPA)
api/index.py         serverless entry point; imports backend/app unchanged
requirements.txt     runtime deps for the function (backend/ keeps its dev extras)
```

---

## The problem

A small D2C seller flags customers whose return rate crosses a policy threshold
(illustratively 20%). A coordinated ring defeats this by splitting activity
across accounts that each sit *just under* the line — so no single account ever
trips the rule.

RefundShield keeps three evidence streams separate and combines them only at the
end, so an investigator can see which kind of evidence is carrying a case:

```
Seller data → Feature engineering
                    ↓
  ┌─────────────────┼─────────────────┐
  Individual    Threshold-Evasion   Relationship
  Risk (P2)      Detector (P3)       Graph (P4)
  └─────────────────┼─────────────────┘
                    ↓
           Coordination Risk (P4)
                    ↓
            Explainability → Investigation Queue → Human investigator
```

---

## Build status

| Phase | Scope | Tests |
|---|---|---|
| 1 | Domain model + deterministic synthetic data (4 scenarios) | 15 ✅ |
| 2 | Feature engineering + individual risk engine | 35 ✅ |
| 3 | Threshold-evasion engine | 33 ✅ |
| 4 | Graph, coordination, explainability, queue, API | 44 ✅ |
| 5 | React + TypeScript investigator frontend | 41 ✅ |

**Backend 127 / 127 · Frontend 41 / 41 passing.**

---

## Running it

```bash
cd refundshield/backend
pip install -r requirements.txt
python -m pytest tests/ -q              # full suite

python tools/inspect_data.py            # the synthetic world, per scenario
python tools/inspect_risk.py            # individual risk scores + explanations
python tools/render_threshold_chart.py  # writes docs/threshold_analysis.html
python tools/render_coordination.py     # writes docs/coordination.html

uvicorn app.main:app --reload --port 8000   # API + Swagger at /docs
```

### Frontend

```bash
cd refundshield/frontend
npm install
npm run dev      # http://localhost:5173 (proxies /api to :8000)
npm test
```

Screens: `docs/screens/` — dashboard, investigation queue, hero investigation,
network explorer, threshold analysis, account detail, scenario lab.

---

## Threshold-Evasion Detection

This is the core technical idea in RefundShield, so it is documented in full.

### 1. Why a threshold becomes an adversarial target

A published rule ("flag above 20%") tells an adversary exactly where to stop. A
per-account rule is also *separable*: the constraint on account A is independent
of the constraint on account B, so splitting activity across five accounts
divides suspicion while multiplying extraction. Tuning the threshold does not
fix this. Any fixed cut-off on a number the adversary controls becomes a target.

### 2. Why the population distribution matters

An individual account at 19% tells you almost nothing — plenty of honest
customers sit at 19%. What is informative is whether there are **more accounts
parked just under the line than the shape of the surrounding distribution can
account for**. That is a property of the population, not of a person.

The established idea is *bunching around a decision threshold*, long used in
public economics to measure behavioural responses to policy kinks. Our
adaptation is to treat near-threshold bunching as a **return-fraud evasion
signal**, and to gate it so that proximity alone can never score highly.

### 3. Binning

Reliable account return rates are binned into fixed-width bins (default 1
percentage point) over a 0–60% domain. Bin edges are computed in **integer basis
points**, so floating-point drift can never move an account across a boundary.

- **Window `W`** = `[threshold − window_width, threshold)` — default `[18%, 20%)`, **half-open**, so an account at exactly 20.00% is *above* the threshold, not inside the window.
- **Reference `R`** = the bins immediately below `W` — default the 6 bins `[12%, 18%)`.
- **Guard** = the bin immediately above the threshold, excluded from the fit because that region is where evasion depletes mass.

### 4. Baseline estimation — and why a flat average fails

The baseline must be *seller-specific*, derived from that seller's own
distribution, never a hard-coded expected count.

The obvious approach — average the neighbouring bins — **does not work**, and
the failure is measurable on our own data. Return-rate distributions decline
steeply through this region. Bins 12–18% average 3.5 accounts each, so a flat
average predicts **7.00** accounts in the 18–20% window. The coordinated
scenario actually contains **6** — *fewer* than flat predicts — so a flat
baseline reports **no bunching at all** in the one scenario it exists to catch.

So the baseline fits a **least-squares straight line through the reference bins**
and extrapolates it across the window. That respects the decline:

| | observed in `W` | flat baseline | **trend baseline** | excess |
|---|---|---|---|---|
| Normal | 1 | 7.00 | **1.29** | −0.29 |
| Coordinated | 6 | 7.00 | **1.29** | **+4.71** |

The baseline is identical in both scenarios because the reference region is
unchanged — the entire difference comes from the window. A regression test
(`test_flat_baseline_would_miss_the_hero_case`) records this so the decision
cannot be quietly undone.

### 5. Excess concentration

```
excess       = observed − expected
excess_ratio = excess / max(expected, floor)
p_value      = P(X ≥ observed)  for  X ~ Poisson(expected)
```

### 6. Signal score

```
magnitude    = min(1, excess_ratio / 3.0)
significance = min(1, −log10(p) / 3.0)
score        = 100 × magnitude × significance        # 0 if excess ≤ 0
```

Significance **gates** magnitude multiplicatively rather than being averaged
with it. An earlier additive version let a large ratio over a tiny baseline
outscore a real excess: 2 accounts against 0.63 expected (ratio 2.2, p = 0.13 —
not surprising) scored **52.5**, while 6 against 2.38 (p = 0.035) scored
**45.0**. Multiplying fixes the ordering, and is the honest reading — an excess
that is not statistically surprising should not score, however large the ratio.

Bands: **LOW 0–29 · MODERATE 30–59 · HIGH 60–79 · VERY HIGH 80–100.**

### 7. Reliability and sample-size handling

| Situation | Treatment |
|---|---|
| Account with < 5 orders | Excluded — rate is too noisy. Counted in `excluded_unreliable`. |
| Fewer than 25 eligible accounts | `reliable = False`, returns *“Insufficient population data”*, score 0. |
| Fewer than 4 reference bins | `reliable = False` — threshold too close to 0%. |
| Fewer than 5 accounts in the reference region | `reliable = False` — no local trend to extrapolate. |
| Negative trend extrapolation | Floored at 0.05/bin and 0.50 across the window, so no division by zero and no runaway ratio. |
| Rate exactly at the threshold | **Above** the threshold. The window is half-open. |
| Rate above the threshold | Outside the window; the existing per-account rule already covers it. |

### 8. The per-account gate

The per-account signal (the Phase 4 hook) is deliberately constrained:

```
gate   = 0.35 + 0.65 × (population_score / 100)
signal = 100 × (0.5 + 0.5 × proximity) × gate
```

With **no** population bunching the gate sits at 0.35, so proximity alone can
never exceed roughly a third of the scale. This is demonstrable live:

| Account | Rate | Population | Signal |
|---|---|---|---|
| ACC-1016 | 18.2% | Normal | **19.1 — LOW** |
| ACC-1032 | 18.4% | Coordinated | **55.3 — MODERATE** |
| ACC-1078 | 19.1% | Coordinated | **71.9 — HIGH** |

Nearly identical proximity, very different signal — because the *population*
decides, not the account.

### 9. Limitations

- **The counterfactual is an assumption.** A straight-line fit over six bins is transparent but crude. A seller whose genuine distribution is bimodal around the threshold would produce a false signal.
- **Small populations are weak.** With 100 accounts the window holds single digits, so the Poisson term does a lot of work and the score is coarse.
- **It cannot see a ring that does not bunch.** A ring spreading members across 5%–19% produces no bunching signal at all; that is what the relationship graph in Phase 4 is for.
- **The scenarios are synthetic.** The bunching exists because the generator put it there. This demonstrates the mechanism; it does not measure real-world performance.
- **The threshold must be known.** If the seller's effective policy differs from the configured value, the window is in the wrong place.

### 10. Why this is not a fraud probability

The output is a **population-level pattern**, not a verdict about a person. The
engine never asserts fraud. Every result carries:

> *Threshold-evasion analysis identifies a population-level pattern. It does not
> determine that any individual customer is fraudulent.*

An elevated result explicitly asks for corroboration:

> *…This is a potential threshold-evasion pattern and requires cross-account
> behavioural and relational evidence.*

A test (`test_language_never_asserts_fraud`) enforces this wording.

---

## Results

| Scenario | Eligible | Observed | Expected | Excess | p | Score | Band |
|---|---|---|---|---|---|---|---|
| Normal Customers | 90 | 1 | 1.29 | −0.29 | 0.7235 | **0.0** | LOW |
| Legitimate Shared Household | 90 | 0 | 0.65 | −0.65 | 1.0000 | **0.0** | LOW |
| Isolated Abuse | 90 | 1 | 1.18 | −0.18 | 0.6930 | **0.0** | LOW |
| **Coordinated Threshold Evasion** | 90 | **6** | **1.29** | **+4.71** | **0.0021** | **89.2** | **VERY HIGH** |

### The hero case

```
INDIVIDUAL VIEW                          THRESHOLD VIEW
ACC-1032  18.4%  LOW  (21.1)             6 reliable accounts in [18%, 20%)
ACC-1047  18.8%  LOW  (21.2)             1.29 expected from the local trend
ACC-1051  19.0%  LOW  (21.4)             excess +4.71,  p = 0.0021
ACC-1062  18.6%  LOW  (21.2)             ──────────────────────────────
ACC-1078  19.1%  LOW  (21.5)             SIGNAL: 89.2 / 100 — VERY HIGH
```

→ *Potential threshold-evasion pattern. Requires cross-account evidence.*
→ **Not** “fraud confirmed”.

---

## Project layout

```
refundshield/
├── backend/
│   ├── app/
│   │   ├── config.py                    # every tunable number, one place
│   │   ├── domain/models.py             # Account, Order, ReturnRequest, Dataset
│   │   ├── data/generator.py            # deterministic synthetic world
│   │   └── engines/
│   │       ├── features.py              # arithmetic only, no judgements
│   │       ├── individual_risk.py       # Phase 2 — per-account rules
│   │       └── threshold_engine.py      # Phase 3 — population bunching
│   ├── tools/                           # inspection + chart rendering
│   ├── tests/                           # 127 tests
│   └── requirements.txt
└── docs/threshold_analysis.html         # screenshot-ready threshold view
```

**Module naming note:** the spec suggested `risk_engine.py`; the file is
`individual_risk.py`, which names the evidence stream rather than the generic
concept — important here because there are three separate risk engines and only
one of them is about individuals.


---

## Coordination Detection

### 1. Graph model

Two graphs are built from the seller's existing records:

- an **entity graph** (accounts, devices, addresses, categories) for visualisation
- an **account-to-account projection** with weighted edges, used for clustering

### 2. Node types

`account` / `device` / `address` / `category`, plus a claim-window marker in the UI.
Entity nodes appear only when more than one account touches them.

### 3. Edge types and weights

| Edge | Class | Base weight | Evidence strength |
|---|---|---|---|
| Shared device | structural | 0.40 | HIGH |
| Shared address | structural | 0.25 | MODERATE |
| Similar claim timing | corroborating | 0.18 | MODERATE |
| Behavioural similarity | corroborating | 0.15 | MODERATE |
| Product / category overlap | corroborating | 0.12 | WEAK-MODERATE |

These are **prototype design weights, not validated fraud probabilities.**

**Structural** edges can create a cluster. **Corroborating** edges normally only add
weight to a pair that is already linked; they can form a cluster alone only when all
three are near-maximal. An earlier version accepted "two reasonably strong"
corroborating signals and chained **93 of 100 accounts into a single component**,
because plenty of honest customers buy the same categories and behave alike.

### 4. Relationship strength - inverse frequency

Every structural weight is scaled by how rare the shared entity is:

```
rarity(e) = log(N / accounts_sharing_e) / log(N / 2)      clipped to [0, 1]
```

A device on 3 of 100 accounts scores about 0.90; an address on 40 of 100 - an office or
a parcel locker - scores about 0.23. Without this the largest and most innocent shared
entities would dominate every cluster.

This also produces a meaningful ordering. A shared **address** across 5 of 50 accounts
weighs 0.179, below the 0.20 edge threshold, so it forms no scored cluster on its own;
a shared **device** across 4 of 50 weighs 0.314 and does. The relationship stays visible
in the entity graph either way.

### 5. Temporal evidence

Computed from actual filing dates, never from a cohort label:

```
temporal_overlap(A,B) = (claims of A within W days of any claim of B
                       + claims of B within W days of any claim of A)
                      / (|A| + |B|)
```

`W` defaults to 6 days. Two claims five months apart score 0.0; two claims two days
apart score 1.0.

### 6. Behavioural similarity

Three readable terms, deliberately not an embedding, so an investigator can be told
which one drove the number: return-rate closeness (5pp tolerance), claim-type mix
cosine, and high-value-return closeness - averaged.

### 7. Cluster detection

Connected components over the weighted projection. Any component larger than 12 is split
with **weighted greedy modularity**. This is necessary, not decorative: with 74 devices
across 100 accounts, accidental collisions are guaranteed by the pigeonhole principle,
and those weak links chain 90+ ordinary accounts into one component. A 93-account
"cluster" is not an investigative unit. Small components are left untouched, so a genuine
five-account group is never reshaped. **No GNN, no embedding.**

### 8. Coordination score

```
network evidence = 0.30*link_strength + 0.20*claim_timing + 0.20*rate_tightness
                 + 0.18*category_overlap + 0.12*claim_homogeneity

coordination     = (0.45*network + 0.40*threshold + 0.15*individual) * benign_factor
```

Two structural guarantees fall out of the weights rather than from tuning:

- **No single relationship can carry a case.** The network components sum to 1.0 and
  none exceeds 0.30, so a cluster sharing only a device cannot pass 30/100.
- **Individual risk cannot drive coordination.** At weight 0.15 the individual stream
  contributes at most 15 points, so it can never reach HIGH alone. If it could, the
  system would simply rediscover the threshold rule it exists to replace.

The threshold input is a **cluster** property - the population bunching score scaled by
how much of the cluster sits in the window - because bunching is a property of a
population, not of a person.

### 9. Explainability

Every reason is generated from actual values. Nothing is a fixed template with a
conclusion baked in, and a test enforces that no explanation ever asserts fraud.

### 10. False-positive protection

`benign_factor` suppresses clusters that look like ordinary households, using three
indicators: category breadth, shared lifespan, and claim-timing dispersion.

**Suppression is the MINIMUM of the three, not their average** - a group must look
ordinary on *every* axis to be treated as benign. Averaging would let a ring that happens
to buy broadly hide behind that single ordinary-looking trait.

The legitimate household scores `benign_factor = 0.20`; the ring scores `0.90`.

**Why a shared address or device does not prove fraud.** Families share tablets.
Flatmates, PG residents and hostel occupants share addresses. Offices receive parcels for
dozens of unrelated people. Each is common, innocent, and indistinguishable from a ring
on that attribute alone. RefundShield therefore treats a relationship as *context* and
requires multiple independent evidence categories before priority rises - and every
high-coordination result is asserted by test to carry at least two.

### 11. Limitations

- **A ring sharing no identity entity is hard to cluster.** The corroborating-only path
  exists but its bar is deliberately near-maximal, so a careful ring using clean devices
  and addresses may not form a cluster at all.
- **Modularity splitting is a heuristic.** It keeps clusters investigable but can cut a
  genuine group that is loosely linked.
- **The benign factor is a design choice, not a measurement.** Its thresholds are
  plausible, not fitted.
- **No payment identifiers.** The domain model has no payout field, so the strongest
  real-world link type - refunds converging on one account - is not implemented.
- **Synthetic data.** The ring is detectable because the generator created it. This
  demonstrates a mechanism; it does not measure real-world performance.

### 12. Future production evolution

A future production system may incorporate validated anomaly detection, supervised risk
models and graph-based learning once labelled or de-identified data becomes available.
The module boundaries are already in place: each engine has a typed contract and none
reads another's internals, so any one can be replaced without touching the rest.

**Scalability, architecturally** - individual scoring runs per account or per request;
threshold analysis runs once per seller population; network analysis runs over suspicious
subsets rather than every order; the queue prioritises what an investigator can actually
work through. No throughput benchmark is claimed.

---

## Phase 4 results

| Scenario | Cluster | n | Individual | Threshold | Network | Benign | Coordination | Priority |
|---|---|---|---|---|---|---|---|---|
| **Coordinated** | C-011 | 5 | 21.3 | 89.2 | 74.9 | 0.90 | **65.3 HIGH** | **URGENT** |
| Household | C-009 | 4 | 5.6 | 0.0 | 55.0 | 0.20 | **5.1 LOW** | LOW |
| Isolated abuse | none | - | 79.9 | 0.0 | 0.0 | 1.00 | **12.0 LOW** | - |
| Normal | C-011 | 3 | 3.2 | 0.0 | 47.9 | 0.29 | **6.9 LOW** | LOW |

### API endpoints

`/api/health` `/api/scenarios` `/api/summary` `/api/accounts` `/api/returns`
`/api/threshold-analysis` `/api/clusters` `/api/clusters/{id}`
`/api/network/{account_id}` `/api/coordination/{account_id}`
`/api/explanations/{account_id}` `/api/investigation-queue` `/api/demo/hero`
