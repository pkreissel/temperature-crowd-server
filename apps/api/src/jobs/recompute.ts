import { db, Tier1RoomMetric, Tier2PublicCohort } from '../db';
import { SEASON_START_MONTH, SEASON_END_MONTH } from './helpers/metrics';
import { EnrichedTier1, K_THRESHOLD, buildCohortsForSeason } from './helpers/cohorts';
import { processYear } from './helpers/sql_aggregations';
import { sql } from 'kysely';

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
  console.log('Starting batch recompute job (SQL optimized)...');

  // Find global years
  const yearsRes = await sql<{ year: number }>`
    SELECT DISTINCT CAST(strftime('%Y', ts) AS INTEGER) AS year
    FROM readings
    WHERE CAST(strftime('%m', ts) AS INTEGER) BETWEEN ${SEASON_START_MONTH} AND ${SEASON_END_MONTH}
  `.execute(db);
  
  const globalYears = yearsRes.rows.map(r => r.year);

  if (globalYears.length === 0) {
    console.log('No readings to process.');
    return;
  }

  const now = Date.now();
  const nowDate = new Date(now);
  
  // We'll collect all EnrichedTier1 per room per year here
  const rawMetricsByRoom = new Map<string, EnrichedTier1[]>();

  for (const year of globalYears) {
    await processYear(year, nowDate, rawMetricsByRoom);
  }
  
  const tier1: Tier1RoomMetric[] = [];
  const bySeason = new Map<string, EnrichedTier1[]>();

  for (const arr of rawMetricsByRoom.values()) {
    if (arr.length !== globalYears.length) {
      // Room is missing data for at least one year in globalYears, so it's not present in ALL years.
      continue;
    }
    for (const enriched of arr) {
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
