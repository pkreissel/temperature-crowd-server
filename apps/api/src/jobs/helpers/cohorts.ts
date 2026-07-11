import { Tier1RoomMetric, Tier2PublicCohort } from '../../db';
import { ClimateRegion } from './climate_regions';
import { CellsByLevel, GRID_LEVELS, GridLevel } from './grid';

// Tier-2 k-anonymous public cohorts with grid merge-up (ADR-0003).

// Public display floor: never publish a cell seen by fewer than K distinct donors.
export const K_THRESHOLD = 10;

// A Tier-1 row plus its spatial keys. Kept in memory only — the cell hierarchy must never be
// persisted to the public tier, where it would be a re-identification vector.
export interface EnrichedTier1 {
  metric: Tier1RoomMetric;
  cells: CellsByLevel;
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function distinctDonors(entries: EnrichedTier1[]): number {
  return new Set(entries.map((e) => e.metric.donor_id)).size;
}

function dominantRegion(entries: EnrichedTier1[]): ClimateRegion {
  const counts = new Map<ClimateRegion, number>();
  for (const e of entries) {
    const r = e.metric.region ?? 'B';
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  let best: ClimateRegion = 'B';
  let bestN = -1;
  for (const [r, n] of counts) {
    if (n > bestN) {
      best = r;
      bestN = n;
    }
  }
  return best;
}

function aggregateCohort(
  cell: string,
  level: GridLevel,
  season: string,
  entries: EnrichedTier1[],
  kSize: number,
): Tier2PublicCohort {
  const m = entries.map((e) => e.metric);
  return {
    cohort_id: `${cell}|${season}`,
    cell,
    season,
    grid_level: level,
    region: dominantRegion(entries),
    k_size: kSize,
    room_count: m.length,
    avg_utgs_kh: mean(m.map((x) => x.utgs_kh)),
    avg_utgs_kh_peak: mean(m.map((x) => x.utgs_kh_peak ?? x.utgs_kh)),
    avg_hours_above_26: mean(m.map((x) => x.hours_above_26)),
    avg_hours_above_28: mean(m.map((x) => x.hours_above_28)),
    avg_hours_above_30: mean(m.map((x) => x.hours_above_30)),
    avg_max_temp: mean(m.map((x) => x.max_temp)),
    avg_tropical_nights: mean(m.map((x) => x.tropical_nights)),
  };
}

// Group pending rooms by their cell at one grid level. Rooms with no cell at this level (e.g.
// unknown PLZ) roll up unconditionally. Cells with ≥ K distinct donors are published; the rest
// roll up to be re-evaluated at the next-coarser level. Returns the rooms that rolled up.
function partitionLevel(
  season: string,
  level: GridLevel,
  pending: EnrichedTier1[],
  cohorts: Tier2PublicCohort[],
): EnrichedTier1[] {
  const groups = new Map<string, EnrichedTier1[]>();
  const rollUp: EnrichedTier1[] = [];

  for (const e of pending) {
    const cell = e.cells[level];
    if (!cell) {
      rollUp.push(e);
      continue;
    }
    let g = groups.get(cell);
    if (!g) {
      g = [];
      groups.set(cell, g);
    }
    g.push(e);
  }

  for (const [cell, g] of groups) {
    const kSize = distinctDonors(g);
    if (kSize >= K_THRESHOLD) cohorts.push(aggregateCohort(cell, level, season, g, kSize));
    else rollUp.push(...g);
  }

  return rollUp;
}

// Walk the grid finest → coarsest, publishing cells that clear K and merging the rest upward.
// The grid is strictly nested, so merge-up is exact and nothing sub-threshold is ever written.
export function buildCohortsForSeason(season: string, entries: EnrichedTier1[]): Tier2PublicCohort[] {
  const cohorts: Tier2PublicCohort[] = [];
  let pending = entries;
  for (const level of GRID_LEVELS) {
    pending = partitionLevel(season, level, pending, cohorts);
    if (pending.length === 0) break;
  }
  // Anything still pending after the national level had < K distinct donors → not published.
  return cohorts;
}
