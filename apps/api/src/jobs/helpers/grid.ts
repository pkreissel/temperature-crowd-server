// Spatial cell hierarchy for the k-anonymity merge-up (ADR-0003).
//
// ADR-0003 specifies the INSPIRE / EEA reference grid (ETRS89-LAEA) as the spatial unit,
// with the finest cell emitted CLIENT-SIDE and precise coordinates never leaving the house.
// That client-side cell emission is not built yet — today the ingest payload carries only a
// German postal code (PLZ). So the aggregation layer merges over a PLZ hierarchy instead:
//
//   plz5 (12345)  ⊂  plz3 (123)  ⊂  plz1 (1)  ⊂  de (national)
//
// The hierarchy is strictly nested (a coarser cell is a digit-prefix of the finer one), so
// merge-up is exact — the same property ADR-0003 relies on for the INSPIRE grid. When the
// client starts emitting an INSPIRE cell, replace `cellsForPostalCode` with a function that
// returns the nested INSPIRE cell ids; nothing else in the recompute needs to change.

export type GridLevel = 'plz5' | 'plz3' | 'plz1' | 'de';

// Finest → coarsest. The merge-up walks this order.
export const GRID_LEVELS: GridLevel[] = ['plz5', 'plz3', 'plz1', 'de'];

export type CellsByLevel = Record<GridLevel, string | null>;

const NATIONAL_CELL = 'de:DE';

/**
 * Nested cell id per level for a postal code. Levels that cannot be derived (missing or
 * malformed PLZ) are null, so such rooms only ever aggregate at the national level — they
 * never pin a fine cell. `de` is always present so every room has a terminal fallback.
 */
export function cellsForPostalCode(postalCode: string | null | undefined): CellsByLevel {
  const digits = (postalCode ?? '').replace(/\D/g, '');
  const valid = digits.length === 5;
  return {
    plz5: valid ? `plz5:${digits}` : null,
    plz3: valid ? `plz3:${digits.slice(0, 3)}` : null,
    plz1: valid ? `plz1:${digits.slice(0, 1)}` : null,
    de: NATIONAL_CELL,
  };
}
