# 0005 — No live weather data in the core; static climate-region map

- Status: Accepted
- Date: 2026-06-29

## Context
An earlier assumption pulled DWD outdoor-temperature data into the architecture. On review,
the core metric (ADR-0002) needs only **indoor** temperature vs. a fixed reference. The
reference comes from the **climate region**, which is a *static* PLZ→{A,B,C} lookup — not a
weather feed.

The main driver for outdoor data was the **6-K rule** (indoor ≥6 K below outdoor). That rule
originates from **commercial-lease** case law — OLG Hamm 28.02.2007 (30 U 131/06) and OLG
Rostock 17.05.2018 (3 U 78/16) — and is **borrowed from workplace standards**
(Arbeitsstättenverordnung, ASR, DIN 1946). Its application to residential flats is analogical
and contested. It must **not** be marketed as a residential guarantee.

## Decision
- Core ingest and metrics are **indoor-only**. No live weather dependency.
- Ship a **static climate-region table** (PLZ → A/B/C with reference temp 25/26/27 °C).
- Treat DWD actual-temps and TRY datasets as **optional, deferred enrichment**, justified only
  by a future *commercial-tenant* evidence feature or sensor-sanity checks — never the
  residential mainline.

## Consequences
- Simpler MVP: no external weather ETL, no station-mapping pipeline on the critical path.
- Residential legal framing rests on the ~26 °C / sustained >28/30 °C thresholds (ADR-0002),
  not the 6-K rule.
- If enrichment is added later, it is a separate, independently-versioned pipeline feeding the
  recompute engine — not coupled to donor ingest.

## References
- Haufe — Mietminderung wegen Hitze: relevante Urteile.
- Krieg Rechtsanwalt — Gewerbemietrecht: Steigende Temperaturen, sinkende Miete? (OLG Hamm/Rostock, ArbStättV/DIN 1946 lineage).
