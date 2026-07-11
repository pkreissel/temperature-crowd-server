# 0003 — Aggregation layer: two materialized tiers, k-anon at build time

- Status: Accepted
- Date: 2026-06-29

## Context
Per ADR-0001 nothing is computed at read time. Indoor temperature time series are personal
data (curves leak occupancy), so the public layer must never expose small groups. ÜTGS is
`Σ max(0, temp − ref)` with `ref` from a region join — a conditional join that Timescale
continuous aggregates cannot express.

## Decision
Two materialized tiers, rebuilt by a recompute job, never queried from raw at read time:

```
raw readings ──► Tier 1: per-room metrics ──► Tier 2: public cohorts
(hypertable)     (ÜTGS, hours>26/28/30,        (grouped + k-anonymity
                  max, tropical nights,          ENFORCED AT BUILD TIME)
                  per room · season)
```

- **Tier 1** drives the donor's private dashboard and feeds Tier 2.
- **Tier 2** is the *only* store the public layer may query. Cells below the k threshold are
  never written, so even a full read-leak of Tier 2 exposes nothing sub-threshold.
- Rebuild is job-driven; erasure marks affected cohorts dirty → rebuild.

## Parameters (locked)
1. **Spatial unit — INSPIRE / EEA reference grid (ETRS89-LAEA), hierarchical.**
   - **Adaptive storage floor (not fixed):** the client emits the **finest INSPIRE level whose
     resident population ≥ T**. At the chosen **T = 25,000** this is **10 km wherever density is
     ≳ national average (~250/km²), 100 km in sparse regions — 1 km is effectively never reached**
     (≈no German 1 km cell has 25,000 residents).
     Decided **client-side, offline**; precise coordinates never leave the house (client
     ADR-0004). Climate region A/B/C rides along on the same lookup. Server stores only the
     emitted `(cell, region)`.
   - **Public display: 10 km where available, else 100 km** (1 km is out of reach at this T).
   - Chosen over PLZ/H3 for uniform cells (predictable k-anon), native nesting (exact merge-up),
     and alignment with German Zensus grid geometry (enables per-dwelling / per-capita
     normalization).
2. **k threshold — k = 10** per published **cell × cohort** combination, enforced at Tier-2
   build time. Stricter floor chosen for safe open-data release.
3. **Sub-threshold cells — merge upward the grid hierarchy** (1→10→100 km) until k≥10; never
   drop. Exact because the grid is nested.
4. **Resident reference (at-rest floor) — Zensus 2022 grid → precomputed safe-cell bitmask.**
   A one-time **server-side build** ingests the Zensus population grid and emits a tiny bitmask
   of "population ≥ T?" per cell. At **T = 25,000** the 1 km mask is effectively all-false (never
   used), so the shipped artifact reduces to a **10 km safe-mask (<1 KB)**; anything not set
   falls back to 100 km. Bundled in the integration release → client decides offline with one
   membership test, no population data, no query, no location leak ("bulk public data, offline
   decision").
   - Parameters of the mask: **basis = residents** (Zensus also publishes dwellings/households
     if we switch), **T = 25,000 residents**, **vintage = `zensus2022`** — pinned in the mask
     header. Changing T or basis = recompute + reship the mask; the architecture is unaffected.

## Two anonymity guarantees, two crowds (do not conflate)
| Guarantee | Hide donor among… | Enforced by | When |
|---|---|---|---|
| **At-rest floor** | ≥ T **residents** (census) | client, offline (bitmask) | emission |
| **Display floor** | ≥ 10 **donors** (k) | server, Tier-2 build | publish |

The client never counts donors (that would leak its cell and create a coordination deadlock);
it counts *residents* from a static public mask. Donor-k is purely a server-side publish filter.

## Consequences
- Strong privacy guarantee is structural, not a query-time filter that can be forgotten.
- Recompute cost paid in batch, not per request.
- Storage layer: TimescaleDB (relational metadata + hypertable in one engine).
- **T = 25,000 keeps 1 km unreachable** and pins the dataset to **10 km (density ≳ national
  average) / 100 km (sparse)**. A deliberate privacy-forward choice: a large at-rest anonymity
  set (≥25k residents per stored location) traded against fine spatial detail. The map shows
  10 km patterns across most populated Germany, not neighborhood/district-level overheating.
  Revisit T if district-level evidence later becomes a goal (lowering T only reships the mask).
- **k=10 then compounds the coarseness**: with a 10 km base and few donors, most cells merge to
  100 km, so the public map sits near national scale until donor numbers are large. Accepted.
- New client requirement: the integration must compute the **INSPIRE cell + climate region**
  locally (ETRS89-LAEA projection) and pick its emission level via the **bundled safe-cell
  bitmask**. Tracked in client ADR-0004.
- New server build artifact: a **Zensus → safe-cell bitmask** generator (run once per T/basis/
  vintage), output shipped with the integration release.

## Implementation status (2026-07-06)
The two-tier build and the k-anon publish filter are implemented and match the decision; the
spatial and at-rest-floor parts are approximated pending the client-side grid work. Deviations
from the target above, all tracked as follow-ups:

- **Spatial unit is a PLZ hierarchy, not the INSPIRE grid (yet).** The client currently transmits
  only `postal_code`, so the server merges over nested cells `plz5 → plz3 → plz1 → national`
  (`jobs/grid.ts`) instead of INSPIRE 1/10/100 km. The hierarchy is still strictly nested, so
  merge-up stays exact. Swapping in a client-emitted INSPIRE cell is a drop-in replacement of
  `cellsForPostalCode` — the rest of the recompute is unchanged. Requires the client to compute
  and emit the ETRS89-LAEA cell first (client ADR-0004).
- **At-rest floor (Zensus safe-cell bitmask) not built.** Only the **display floor** (k=10
  distinct donors, enforced at Tier-2 build in `jobs/cohorts.ts`) is live. The census-resident
  at-rest guarantee still needs the bitmask generator and the client-side membership test.
- **k=10 with merge-up is implemented**: sub-threshold cells roll up the hierarchy and are never
  written; if even the national cell has < 10 donors, nothing is published.
- **Storage engine is libSQL/SQLite (Bunny DB), not TimescaleDB.** No hypertable / continuous
  aggregates; recompute is a full batch rebuild of both tiers in one transaction, which suits the
  low hourly volume. Revisit if raw volume outgrows single-node SQLite.
- **Climate region** is derived server-side from PLZ via a coarse 2-digit table
  (`jobs/climate_regions.ts`), a placeholder for the authoritative DIN 4108-2 map (ADR-0005).
