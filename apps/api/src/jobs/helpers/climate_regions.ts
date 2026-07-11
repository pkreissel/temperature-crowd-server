// Static climate-region lookup (ADR-0002 / ADR-0005).
//
// DIN 4108-2 Beiblatt 2 divides Germany into three summer climate regions with a
// reference indoor temperature each:
//   A = 25 °C (sommerkühl — North Sea / Baltic coast, higher uplands)
//   B = 26 °C (gemäßigt   — most of Germany; the default)
//   C = 27 °C (sommerheiß — Oberrheingraben, Rhein-Main, Köln/Bonn lowland)
//
// The authoritative assignment is a geographic map, not a clean PLZ split. The table
// below is a DELIBERATELY CONSERVATIVE approximation keyed on the 2-digit PLZ prefix:
// only clear-cut coastal (A) and warm-lowland (C) prefixes are listed; everything else
// falls back to B. This is the "static climate-region table" ADR-0005 calls for, at
// coarse resolution — replace `REGION_BY_PLZ2` with the exact DIN map (per-PLZ) when the
// authoritative dataset is sourced. The rest of the pipeline is unaffected by that swap.

export type ClimateRegion = 'A' | 'B' | 'C';

export const REF_TEMP: Record<ClimateRegion, number> = {
  A: 25,
  B: 26,
  C: 27,
};

// 2-digit PLZ prefix -> region. Absent prefixes default to B.
const REGION_BY_PLZ2: Record<string, ClimateRegion> = {
  // --- Region A: North Sea & Baltic coast ---
  '17': 'A', // Vorpommern / Rügen coast
  '18': 'A', // Rostock / Fischland-Darß
  '23': 'A', // Lübeck / Ostholstein
  '24': 'A', // Kiel / Schleswig
  '25': 'A', // Dithmarschen / Nordfriesland
  '26': 'A', // Ostfriesland / Emden
  '27': 'A', // Bremerhaven / Cuxhaven / Elbe-Weser

  // --- Region C: upper Rhine + Rhine-Main + Köln/Bonn lowland ---
  '50': 'C', // Köln
  '51': 'C', // Leverkusen / Bergisch (Rhine lowland edge)
  '53': 'C', // Bonn
  '60': 'C', // Frankfurt a.M.
  '63': 'C', // Offenbach / Aschaffenburg
  '64': 'C', // Darmstadt
  '65': 'C', // Wiesbaden / Rheingau
  '67': 'C', // Ludwigshafen / Vorderpfalz
  '68': 'C', // Mannheim
  '69': 'C', // Heidelberg
  '76': 'C', // Karlsruhe
  '77': 'C', // Offenburg / Ortenau
  '79': 'C', // Freiburg / Markgräflerland
};

/**
 * Map a German postal code to its summer climate region.
 * Unknown / malformed / null PLZ → 'B' (the nationwide default, most protective-neutral).
 */
export function regionForPostalCode(postalCode: string | null | undefined): ClimateRegion {
  if (!postalCode) return 'B';
  const digits = postalCode.replace(/\D/g, '');
  if (digits.length < 2) return 'B';
  return REGION_BY_PLZ2[digits.slice(0, 2)] ?? 'B';
}
