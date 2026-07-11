import { Reading } from '../../db';
import { ClimateRegion, REF_TEMP } from './climate_regions';

// Tier-1 per-room seasonal metric computation (ADR-0002).

// ÜTGS accrues in summer; default reporting window is Jun–Sep (ADR-0002). Months are 1-based.
export const SEASON_START_MONTH = 6; // June
export const SEASON_END_MONTH = 9; // September (inclusive)

const HOUR_MS = 3600_000;

export interface RoomSeasonMetrics {
  utgs_kh: number;
  utgs_kh_peak: number;
  hours_above_26: number;
  hours_above_28: number;
  hours_above_30: number;
  max_temp: number;
  tropical_nights: number;
  coverage_pct: number;
  observed_hours: number;
}

interface HourBucket {
  sum: number; // Σ hourly-mean readings that fell in this hour
  n: number;
  max: number; // hourly max (for the peak ÜTGS variant)
}

export function seasonLabel(year: number): string {
  return `${year}-summer`;
}

// UTC [start, end) bounds of a season's summer window.
export function seasonWindow(year: number): { start: number; end: number } {
  return {
    start: Date.UTC(year, SEASON_START_MONTH - 1, 1, 0, 0, 0),
    end: Date.UTC(year, SEASON_END_MONTH, 1, 0, 0, 0), // first instant of October
  };
}

// Season years actually present in a room's readings' summer windows.
export function seasonYearsIn(readings: Reading[]): number[] {
  const years = new Set<number>();
  for (const r of readings) {
    const d = new Date(r.ts);
    if (Number.isNaN(d.getTime())) continue;
    const month = d.getUTCMonth() + 1;
    if (month >= SEASON_START_MONTH && month <= SEASON_END_MONTH) years.add(d.getUTCFullYear());
  }
  return [...years];
}

// Most recent non-null postal code for a room.
export function latestPostalCode(readings: Reading[]): string | null {
  let postal: string | null = null;
  let latest = -Infinity;
  for (const r of readings) {
    if (!r.postal_code) continue;
    const t = Date.parse(r.ts);
    if (t > latest) {
      latest = t;
      postal = r.postal_code;
    }
  }
  return postal;
}

// Collapse readings to distinct hourly buckets. Readings are hourly already (HA long-term
// statistics), but ingest can carry sub-hourly or duplicate rows; bucketing guarantees each
// clock-hour counts once, fixing the old "+= per reading" over-count.
function bucketByHour(readings: Reading[], window: { start: number; end: number }): Map<number, HourBucket> {
  const hourly = new Map<number, HourBucket>();
  for (const r of readings) {
    const t = Date.parse(r.ts);
    if (Number.isNaN(t) || t < window.start || t >= window.end) continue;
    const hourEpoch = Math.floor(t / HOUR_MS);
    let b = hourly.get(hourEpoch);
    if (!b) {
      b = { sum: 0, n: 0, max: -Infinity };
      hourly.set(hourEpoch, b);
    }
    b.sum += r.temp_c;
    b.n += 1;
    const peak = r.temp_c_max ?? r.temp_c;
    if (peak > b.max) b.max = peak;
  }
  return hourly;
}

// A night keyed by the calendar date it starts on; hours before 07:00 belong to the previous
// day's night. Returns null for daytime hours (07:00–21:59), which never define a night.
function nightKey(hourEpoch: number): string | null {
  const hourOfDay = new Date(hourEpoch * HOUR_MS).getUTCHours();
  if (hourOfDay < 22 && hourOfDay >= 7) return null;
  const start = hourOfDay < 7 ? hourEpoch * HOUR_MS - 24 * HOUR_MS : hourEpoch * HOUR_MS;
  const d = new Date(start);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function thresholdHit(mean: number, limit: number): number {
  return mean > limit ? 1 : 0;
}

interface Accumulated {
  utgs: number;
  utgsPeak: number;
  hours26: number;
  hours28: number;
  hours30: number;
  maxTemp: number;
  nightMin: Map<string, number>; // coldest hourly mean observed per night
}

function summarizeBuckets(hourly: Map<number, HourBucket>, refTemp: number): Accumulated {
  const acc: Accumulated = {
    utgs: 0,
    utgsPeak: 0,
    hours26: 0,
    hours28: 0,
    hours30: 0,
    maxTemp: -Infinity,
    nightMin: new Map(),
  };
  for (const [hourEpoch, b] of hourly) {
    const mean = b.sum / b.n;
    const peak = b.max;
    acc.utgs += Math.max(0, mean - refTemp);
    acc.utgsPeak += Math.max(0, peak - refTemp);
    acc.hours26 += thresholdHit(mean, 26);
    acc.hours28 += thresholdHit(mean, 28);
    acc.hours30 += thresholdHit(mean, 30);
    if (peak > acc.maxTemp) acc.maxTemp = peak;
    const key = nightKey(hourEpoch);
    if (key === null) continue;
    const prev = acc.nightMin.get(key);
    if (prev === undefined || mean < prev) acc.nightMin.set(key, mean);
  }
  return acc;
}

// Tropical night indoors: a night that never cools below 25 °C (ADR-0002).
function countTropicalNights(nightMin: Map<string, number>): number {
  let n = 0;
  for (const min of nightMin.values()) if (min > 25) n += 1;
  return n;
}

// Coverage: observed hours vs. hours elapsed in the window so far — don't credit the future,
// don't extrapolate (ADR-0002). Window end is capped at `now`.
function coveragePct(observedHours: number, window: { start: number; end: number }, now: number): number {
  const elapsed = Math.max(0, (Math.min(window.end, now) - window.start) / HOUR_MS);
  return elapsed > 0 ? Math.min(100, (100 * observedHours) / elapsed) : 0;
}

export function computeRoomSeason(
  readings: Reading[],
  region: ClimateRegion,
  window: { start: number; end: number },
  now: number,
): RoomSeasonMetrics {
  const hourly = bucketByHour(readings, window);
  const acc = summarizeBuckets(hourly, REF_TEMP[region]);
  return {
    utgs_kh: acc.utgs,
    utgs_kh_peak: acc.utgsPeak,
    hours_above_26: acc.hours26,
    hours_above_28: acc.hours28,
    hours_above_30: acc.hours30,
    max_temp: acc.maxTemp === -Infinity ? 0 : acc.maxTemp,
    tropical_nights: countTropicalNights(acc.nightMin),
    coverage_pct: coveragePct(hourly.size, window, now),
    observed_hours: hourly.size,
  };
}
