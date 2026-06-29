# Architecture Decision Records — Server

Each file records one decision: context → decision → consequences. Append-only —
supersede with a new ADR rather than editing an accepted one. Status is one of
`Proposed`, `Accepted`, `Superseded by NNNN`.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-store-raw-recompute.md) | Store raw readings, treat ÜTGS as recomputable | Accepted |
| [0002](0002-metric-definition.md) | Metric definition: measured ÜTGS + companion metrics | Accepted |
| [0003](0003-aggregation-layer.md) | Aggregation layer: two materialized tiers, k-anon at build time (INSPIRE grid, k=10) | Accepted |
| [0004](0004-identity-unlinkability.md) | Identity: blind-signed long-lived credential (RFC 9474) + no precise location | Accepted |
| [0005](0005-no-live-weather-in-core.md) | No live weather data in the core; static climate-region map | Accepted |
| [0006](0006-versioned-ingest-contract.md) | Versioned, additive-only ingest contract | Accepted |
| [0007](0007-hosting-ip-handling-bunny.md) | Hosting & IP handling on Bunny Magic Containers | Accepted |
