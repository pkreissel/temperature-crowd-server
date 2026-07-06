import { db, Reading, Tier1RoomMetric, Tier2PublicCohort } from '../db';
import { regionForPostalCode } from './helpers/climate_regions';
import { cellsForPostalCode } from './helpers/grid';
import {
  RoomSeasonMetrics,
  computeRoomSeason,
  latestPostalCode,
  seasonLabel,
  seasonWindow,
  seasonYearsIn,
} from './helpers/metrics';
import { EnrichedTier1, K_THRESHOLD, buildCohortsForSeason } from './helpers/cohorts';

/* eslint-disable no-console */

// Recompute engine: raw readings → Tier-1 per-room metrics → Tier-2 public cohorts (ADR-0001,
// 0002, 0003). Both tiers are pure derived views, rebuilt wholesale from raw on every run.

function groupByRoom(readings: Reading[]): Map<string, Reading[]> {
  const byRoom = new Map<string, Reading[]>();
  for (const r of readings) {
    const key = `${r.donor_id} ${r.device_id}`;
    let arr = byRoom.get(key);
    if (!arr) {
      arr = [];
      byRoom.set(key, arr);
    }
    arr.push(r);
  }
  return byRoom;
}

function toTier1Row(
  sample: Reading,
  season: string,
  region: 'A' | 'B' | 'C',
  m: RoomSeasonMetrics,
): Tier1RoomMetric {
  return {
    donor_id: sample.donor_id,
    device_id: sample.device_id,
    room_ref: sample.room_ref,
    season,
    region,
    utgs_kh: m.utgs_kh,
    utgs_kh_peak: m.utgs_kh_peak,
    hours_above_26: m.hours_above_26,
    hours_above_28: m.hours_above_28,
    hours_above_30: m.hours_above_30,
    max_temp: m.max_temp,
    tropical_nights: m.tropical_nights,
    coverage_pct: m.coverage_pct,
  };
}

// One room → its per-season Tier-1 rows, each carrying the spatial keys Tier-2 needs.
function processRoom(roomReadings: Reading[], now: number): EnrichedTier1[] {
  const postalCode = latestPostalCode(roomReadings);
  const region = regionForPostalCode(postalCode);
  const cells = cellsForPostalCode(postalCode);
  const out: EnrichedTier1[] = [];
  for (const year of seasonYearsIn(roomReadings)) {
    const metrics = computeRoomSeason(roomReadings, region, seasonWindow(year), now);
    if (metrics.observed_hours === 0) continue;
    const row = toTier1Row(roomReadings[0], seasonLabel(year), region, metrics);
    out.push({ metric: row, cells });
  }
  return out;
}

// Atomic rebuild: both tiers are pure derived views (ADR-0001), so replace wholesale rather
// than upsert. This also drops rows for erased donors and stale sub-threshold cells for free.
async function persistTiers(tier1: Tier1RoomMetric[], tier2: Tier2PublicCohort[]): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('tier1_room_metrics').execute();
    if (tier1.length > 0) await trx.insertInto('tier1_room_metrics').values(tier1).execute();
    await trx.deleteFrom('tier2_public_cohorts').execute();
    if (tier2.length > 0) await trx.insertInto('tier2_public_cohorts').values(tier2).execute();
  });
}

export async function runRecomputeJob(): Promise<void> {
  console.log('Starting batch recompute job...');

  const readings = await db.selectFrom('readings').selectAll().execute();
  if (readings.length === 0) {
    console.log('No readings to process.');
    return;
  }

  const now = Date.now();
  const tier1: Tier1RoomMetric[] = [];
  const bySeason = new Map<string, EnrichedTier1[]>();

  for (const roomReadings of groupByRoom(readings).values()) {
    for (const enriched of processRoom(roomReadings, now)) {
      tier1.push(enriched.metric);
      const season = enriched.metric.season;
      const bucket = bySeason.get(season) ?? [];
      bucket.push(enriched);
      bySeason.set(season, bucket);
    }
  }

  const tier2: Tier2PublicCohort[] = [];
  for (const [season, entries] of bySeason) tier2.push(...buildCohortsForSeason(season, entries));

  await persistTiers(tier1, tier2);

  const suppressed = bySeason.size > 0 && tier2.length === 0;
  console.log(
    `Recompute done: ${tier1.length} room-seasons, ${tier2.length} published cohorts` +
      (suppressed ? ` (all cells below k=${K_THRESHOLD}, nothing published)` : ''),
  );
}
