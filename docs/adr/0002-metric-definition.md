# 0002 — Metric definition: measured ÜTGS + companion metrics

- Status: Accepted
- Date: 2026-06-29

## Context
DIN 4108-2:2013-02 defines Übertemperaturgradstunden (ÜTGS) as a **simulation** metric for
the building permit: an hourly thermal simulation over a Test Reference Year, using
**operative** temperature, with limits of **1200 Kh/a (residential)** / **500 Kh/a
(non-residential)**, and a reference indoor temperature set by summer climate region
(A=25 °C Rostock-Warnemünde, B=26 °C Potsdam, C=27 °C Mannheim). GEG §14 makes this
verification mandatory for new builds and extensions >50 m².

Our data is **measured** indoor air temperature from occupied dwellings — a different
quantity from the simulated operative temperature. We must not claim a measured value is a
DIN "violation" in the strict sense; it is evidence the norm's protective intent fails in
operation.

## Decision
Primary metric: **measured ÜTGS** =
`Σ_hours max(0, T_indoor(h) − T_ref(region))` in Kh, where `T_ref` ∈ {25,26,27} by region.
- Compute on the **hourly mean** (matches HA long-term statistics); also compute a
  **peak variant on hourly max** to bound the under-counting from averaging.
- Label it explicitly as *measured air-temperature ÜTGS*, distinct from the DIN simulation;
  compare against 1200 Kh/a as a **reference line**, not a legal verdict.

Companion metrics (more robust, harder to dispute, drive the public dashboard):
hours > 26/28/30 °C, annual/seasonal max, and **tropical nights indoors** (T > 25 °C at night).

Partial-year handling: compute over the observed window, report **coverage %**, default to
the summer season (Jun–Sep) where essentially all ÜTGS accrues; do not silently extrapolate.

## Consequences
- Honest framing protects credibility and the Mietrecht use case.
- Air-vs-operative gap is acknowledged and bounded, not hidden.
- Legal evidence for **residential** donors leans on the ~26 °C acceptability threshold and
  sustained >28/30 °C (AG Hamburg line), **not** the commercial-lease 6-K rule — see ADR-0005.
