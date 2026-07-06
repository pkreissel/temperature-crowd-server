import { db, Tier1RoomMetric } from '../db';

const REF_TEMP: Record<'A' | 'B' | 'C', number> = {
  A: 25,
  B: 26,
  C: 27,
};

function calculateTier1Metric(roomReadings: any[]): Tier1RoomMetric {
  const sample = roomReadings[0];
  const region = 'B'; 
  const refTemp = REF_TEMP[region];

  let utgsKh = 0;
  let hoursAbove26 = 0;
  let hoursAbove28 = 0;
  let hoursAbove30 = 0;
  let maxTemp = 0;
  let tropicalNights = 0;

  for (const r of roomReadings) {
    if (r.temp_c > refTemp) {
      utgsKh += (r.temp_c - refTemp);
    }
    if (r.temp_c > 26) hoursAbove26++;
    if (r.temp_c > 28) hoursAbove28++;
    if (r.temp_c > 30) hoursAbove30++;
    if (r.temp_c > maxTemp) maxTemp = r.temp_c;
    
    const hour = new Date(r.ts).getUTCHours();
    if ((hour >= 22 || hour <= 6) && r.temp_c > 25) {
      tropicalNights++;
    }
  }

  return {
    donor_id: sample.donor_id,
    device_id: sample.device_id,
    room_ref: sample.room_ref,
    season: '2026-summer',
    utgs_kh: utgsKh,
    hours_above_26: hoursAbove26,
    hours_above_28: hoursAbove28,
    hours_above_30: hoursAbove30,
    max_temp: maxTemp,
    tropical_nights: tropicalNights,
    coverage_pct: 100
  };
}

export async function runRecomputeJob() {
  /* eslint-disable no-console */
  console.log('Starting batch recompute job...');

  const readings = await db.selectFrom('readings').selectAll().execute();
  
  if (readings.length === 0) {
    console.log('No readings to process.');
    return;
  }

  const grouped: Record<string, typeof readings> = {};
  for (const r of readings) {
    const key = `${r.donor_id}_${r.device_id}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }

  const tier1Metrics: Tier1RoomMetric[] = [];
  for (const roomReadings of Object.values(grouped)) {
    tier1Metrics.push(calculateTier1Metric(roomReadings));
  }

  if (tier1Metrics.length > 0) {
    await db.insertInto('tier1_room_metrics')
      .values(tier1Metrics)
      .onConflict((oc) => oc
        .columns(['donor_id', 'device_id', 'season'])
        .doUpdateSet({
          utgs_kh: (eb) => eb.ref('excluded.utgs_kh'),
          hours_above_26: (eb) => eb.ref('excluded.hours_above_26'),
          hours_above_28: (eb) => eb.ref('excluded.hours_above_28'),
          hours_above_30: (eb) => eb.ref('excluded.hours_above_30'),
          max_temp: (eb) => eb.ref('excluded.max_temp'),
          tropical_nights: (eb) => eb.ref('excluded.tropical_nights'),
        })
      ).execute();
  }

  if (tier1Metrics.length >= 5) {
    const kSize = tier1Metrics.length;
    const avgUtgs = tier1Metrics.reduce((sum, m) => sum + m.utgs_kh, 0) / kSize;
    const avgHrs26 = tier1Metrics.reduce((sum, m) => sum + m.hours_above_26, 0) / kSize;
    const avgMax = tier1Metrics.reduce((sum, m) => sum + m.max_temp, 0) / kSize;

    await db.insertInto('tier2_public_cohorts')
      .values([{
        cohort_id: 'global-2026-summer',
        k_size: kSize,
        avg_utgs_kh: avgUtgs,
        avg_hours_above_26: avgHrs26,
        avg_max_temp: avgMax
      }])
      .onConflict((oc) => oc.column('cohort_id').doUpdateSet({
        k_size: (eb) => eb.ref('excluded.k_size'),
        avg_utgs_kh: (eb) => eb.ref('excluded.avg_utgs_kh'),
        avg_hours_above_26: (eb) => eb.ref('excluded.avg_hours_above_26'),
        avg_max_temp: (eb) => eb.ref('excluded.avg_max_temp'),
      }))
      .execute();
      
      console.log(`Tier 2 cohort rebuilt with k=${kSize}`);
  } else {
    console.log(`Skipping Tier 2 rebuild: insufficient k-size (${tier1Metrics.length} < 5)`);
  }

  console.log('Batch recompute job finished.');
}
