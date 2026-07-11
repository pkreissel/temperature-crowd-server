# Architecture Decision Records — Server

Jede Datei hält eine Entscheidung fest: Kontext → Entscheidung → Konsequenzen. Append-only —
eine akzeptierte ADR wird nicht bearbeitet, sondern durch eine neue ADR ersetzt. Der Status ist einer von
`Proposed`, `Accepted`, `Superseded by NNNN`.

| # | Titel | Status |
|---|-------|--------|
| [0001](0001-store-raw-recompute.md) | Rohmesswerte speichern, ÜTGS als neu berechenbar behandeln | Akzeptiert |
| [0002](0002-metric-definition.md) | Metrik-Definition: gemessener ÜTGS + Begleitmetriken | Akzeptiert |
| [0003](0003-aggregation-layer.md) | Aggregationsschicht: zwei materialisierte Stufen, k-Anon zur Build-Zeit (INSPIRE-Grid als Ziel; PLZ-Hierarchie in der Umsetzung, k=10) | Akzeptiert |
| [0004](0004-identity-unlinkability.md) | Identität: RFC-9474-Blind-RSA-(RSASSA-PSS-)Credential + kein präziser Standort | Akzeptiert |
| [0005](0005-no-live-weather-in-core.md) | Keine Live-Wetterdaten im Kern; statische Klimaregion-Karte | Akzeptiert |
| [0006](0006-versioned-ingest-contract.md) | Versionierter, ausschließlich additiver Ingest-Contract | Akzeptiert |
| [0007](0007-hosting-ip-handling-bunny.md) | Hosting & IP-Handling auf Bunny Magic Containers | Akzeptiert |

---

# Architecture Decision Records — Server (English)

Each file records one decision: context → decision → consequences. Append-only —
supersede with a new ADR rather than editing an accepted one. Status is one of
`Proposed`, `Accepted`, `Superseded by NNNN`.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-store-raw-recompute.md) | Store raw readings, treat ÜTGS as recomputable | Accepted |
| [0002](0002-metric-definition.md) | Metric definition: measured ÜTGS + companion metrics | Accepted |
| [0003](0003-aggregation-layer.md) | Aggregation layer: two materialized tiers, k-anon at build time (INSPIRE grid target; PLZ hierarchy in impl, k=10) | Accepted |
| [0004](0004-identity-unlinkability.md) | Identity: RFC 9474 Blind RSA (RSASSA-PSS) credential + no precise location | Accepted |
| [0005](0005-no-live-weather-in-core.md) | No live weather data in the core; static climate-region map | Accepted |
| [0006](0006-versioned-ingest-contract.md) | Versioned, additive-only ingest contract | Accepted |
| [0007](0007-hosting-ip-handling-bunny.md) | Hosting & IP handling on Bunny Magic Containers | Accepted |
