# 0001 — Store raw readings, treat ÜTGS as recomputable

- Status: Accepted
- Date: 2026-06-29

## Context
ÜTGS depends on inputs that are not known, or not final, at ingest time:
- the climate-region reference temperature (25/26/27 °C) via a PLZ→region lookup that may be corrected,
- sensor calibration offsets discovered later,
- partial-year coverage and the chosen norm variant (hourly-mean vs. peak/max),
- any future enrichment (e.g. outdoor delta) that arrives after the fact.

If ÜTGS were computed and frozen at write time, each of these changes would force a
data migration, and erasure (DSGVO) would require surgically unwinding precomputed values.

## Decision
Store **raw hourly readings** as the single source of truth. ÜTGS and all companion
metrics are **derived, recomputable views** — materialized and refreshed by a job, never
written at ingest. Ingest is "dumb": validate, normalize to UTC + °C, upsert.

## Consequences
- Recompute is a pure function over stored raw data; changing the reference table or a
  calibration offset is a rebuild, not a migration.
- **Erasure is solved for free** (see what would have been ADR-0003 on erasure): delete the
  donor's raw rows, mark affected aggregates dirty, rebuild. No precomputed value survives.
- Cost: storage of full-resolution raw data and a recompute pipeline. Acceptable — hourly
  data is ~24 rows/sensor/day.
- Requires idempotent upsert on `(device_id, ts)` so backfill and live data converge safely.
