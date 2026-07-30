// Static climate-region lookup (ADR-0002 / ADR-0005).
//
// DIN 4108-2 Beiblatt 2 divides Germany into three summer climate regions with a
// reference indoor temperature each:
//   A = 25 °C (sommerkühl — North Sea / Baltic coast, higher uplands)
//   B = 26 °C (gemäßigt   — most of Germany; the default)
//   C = 27 °C (sommerheiß — Oberrheingraben, Rhein-Main, Köln/Bonn lowland)
//
// The authoritative assignment is a geographic map, not a clean PLZ split. The PLZ-prefix
// approximation of this table (2-digit prefix -> region, everything else falls back to B)
// is applied directly in the SQL aggregation (sql_aggregations.ts) for performance; replace
// both with the exact DIN map (per-PLZ) together when the authoritative dataset is sourced.

export type ClimateRegion = 'A' | 'B' | 'C';
