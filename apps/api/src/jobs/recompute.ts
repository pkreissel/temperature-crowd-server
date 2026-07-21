import { db, Tier1RoomMetric, Tier2PublicCohort } from '../db';
import { cellsForPostalCode } from './helpers/grid';
import {
  seasonLabel,
  seasonWindow,
  SEASON_START_MONTH,
  SEASON_END_MONTH
} from './helpers/metrics';
import { EnrichedTier1, K_THRESHOLD, buildCohortsForSeason } from './helpers/cohorts';
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
    const window = seasonWindow(year);
    const nowForYear = Date.UTC(
      year,
      nowDate.getUTCMonth(),
      nowDate.getUTCDate(),
      nowDate.getUTCHours(),
      nowDate.getUTCMinutes(),
      nowDate.getUTCSeconds(),
      nowDate.getUTCMilliseconds()
    );
    const cappedWindow = {
      start: window.start,
      end: Math.min(window.end, nowForYear),
    };
    
    const query = sql<any>`
      WITH params AS (
        SELECT ${cappedWindow.start} as start_ms, ${cappedWindow.end} as end_ms
      ),
      raw_in_window AS (
        SELECT
          donor_id,
          device_id,
          postal_code,
          room_ref,
          ts,
          temp_c,
          temp_c_max,
          unixepoch(ts) * 1000 AS ts_ms
        FROM readings
        JOIN params ON unixepoch(ts) * 1000 >= params.start_ms AND unixepoch(ts) * 1000 < params.end_ms
      ),
      hourly AS (
        SELECT
          donor_id,
          device_id,
          MAX(postal_code) AS postal_code,
          MAX(room_ref) AS room_ref,
          strftime('%Y-%m-%d %H:00:00', ts) AS hour_bucket,
          CASE
            WHEN CAST(strftime('%H', ts) AS INTEGER) >= 22 OR CAST(strftime('%H', ts) AS INTEGER) < 7
            THEN date(ts, '-7 hours')
            ELSE NULL
          END AS night_key,
          AVG(temp_c) AS mean,
          MAX(COALESCE(temp_c_max, temp_c)) AS peak
        FROM raw_in_window
        GROUP BY donor_id, device_id, hour_bucket
      ),
      room_meta AS (
        SELECT
          donor_id,
          device_id,
          CASE
            WHEN substr(postal_code, 1, 2) IN ('17','18','23','24','25','26','27') THEN 25
            WHEN substr(postal_code, 1, 2) IN ('50','51','53','60','63','64','65','67','68','69','76','77','79') THEN 27
            ELSE 26
          END AS ref_temp,
          CASE
            WHEN substr(postal_code, 1, 2) IN ('17','18','23','24','25','26','27') THEN 'A'
            WHEN substr(postal_code, 1, 2) IN ('50','51','53','60','63','64','65','67','68','69','76','77','79') THEN 'C'
            ELSE 'B'
          END AS region_id
        FROM (
          SELECT donor_id, device_id, MAX(postal_code) as postal_code FROM hourly GROUP BY donor_id, device_id
        )
      ),
      nightly AS (
        SELECT
          donor_id,
          device_id,
          night_key,
          MIN(mean) AS min_mean
        FROM hourly
        WHERE night_key IS NOT NULL
        GROUP BY donor_id, device_id, night_key
      ),
      tropical_counts AS (
        SELECT
          donor_id,
          device_id,
          SUM(CASE WHEN min_mean > 25 THEN 1 ELSE 0 END) AS tropical_nights
        FROM nightly
        GROUP BY donor_id, device_id
      ),
      aggregated AS (
        SELECT
          h.donor_id,
          h.device_id,
          MAX(h.postal_code) AS postal_code,
          MAX(h.room_ref) AS room_ref,
          COUNT(h.hour_bucket) AS observed_hours,
          MAX(m.ref_temp) AS ref_temp,
          MAX(m.region_id) AS region_id,
          SUM(CASE WHEN h.mean > m.ref_temp THEN h.mean - m.ref_temp ELSE 0 END) AS utgs_kh,
          SUM(CASE WHEN h.peak > m.ref_temp THEN h.peak - m.ref_temp ELSE 0 END) AS utgs_kh_peak,
          SUM(CASE WHEN h.mean > 26 THEN 1 ELSE 0 END) AS hours_above_26,
          SUM(CASE WHEN h.mean > 28 THEN 1 ELSE 0 END) AS hours_above_28,
          SUM(CASE WHEN h.mean > 30 THEN 1 ELSE 0 END) AS hours_above_30,
          MAX(h.peak) AS max_temp
        FROM hourly h
        JOIN room_meta m ON h.donor_id = m.donor_id AND h.device_id = m.device_id
        GROUP BY h.donor_id, h.device_id
      )
      SELECT
        a.*,
        COALESCE(t.tropical_nights, 0) AS tropical_nights
      FROM aggregated a
      LEFT JOIN tropical_counts t ON a.donor_id = t.donor_id AND a.device_id = t.device_id;
    `;

    const res = await query.execute(db);

    for (const row of res.rows) {
      if (row.observed_hours === 0) continue; // safety check
      
      const key = `${row.donor_id} ${row.device_id}`;
      let arr = rawMetricsByRoom.get(key);
      if (!arr) {
        arr = [];
        rawMetricsByRoom.set(key, arr);
      }
      
      const elapsed = Math.max(0, (cappedWindow.end - cappedWindow.start) / 3600_000);
      const coverage_pct = elapsed > 0 ? Math.min(100, (100 * row.observed_hours) / elapsed) : 0;
      
      const metric: Tier1RoomMetric = {
        donor_id: row.donor_id,
        device_id: row.device_id,
        room_ref: row.room_ref,
        season: seasonLabel(year),
        region: row.region_id as any,
        utgs_kh: row.utgs_kh,
        utgs_kh_peak: row.utgs_kh_peak,
        hours_above_26: row.hours_above_26,
        hours_above_28: row.hours_above_28,
        hours_above_30: row.hours_above_30,
        max_temp: row.max_temp === null ? 0 : row.max_temp,
        tropical_nights: row.tropical_nights,
        coverage_pct
      };
      
      arr.push({ metric, cells: cellsForPostalCode(row.postal_code) });
    }
  }
  
  const tier1: Tier1RoomMetric[] = [];
  const bySeason = new Map<string, EnrichedTier1[]>();

  for (const [key, arr] of rawMetricsByRoom) {
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
