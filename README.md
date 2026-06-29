# TemperaturCrowd — Server

Monorepo for everything we deploy ourselves. Will become its own git repo.

## Layout
- `apps/api` — ingest API + ÜTGS engine (canonical `/v1/ingest`, batch + idempotent).
- `apps/web` — public dashboard (aggregate overheating map) + private donor dashboard.
- `packages/contract` — the canonical ingest schema (OpenAPI / JSON Schema) shared with
  every client (HACS integration, Ecowitt, DIY). The versioned boundary between repos.

## Core idea
Reconstruct **measured Übertemperaturgradstunden (ÜTGS)** from donated indoor-temperature
time series and compare against the DIN 4108-2 design threshold (1200 Kh/a residential)
for the location's climate region (A/B/C → 25/26/27 °C).

See `packages/contract` for the data boundary; the HACS integration lives in `../hacs`.
