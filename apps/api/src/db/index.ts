import { Database } from 'bun:sqlite';
import { Kysely, sql } from 'kysely';
import { BunSqliteDialect } from 'kysely-bun-sqlite';

export interface Reading {
  id?: number;
  device_id: string;
  donor_id: string;
  ts: string;
  temp_c: number;
  temp_c_min: number | null;
  temp_c_max: number | null;
  rh_pct: number | null;
  room_ref: string | null;
  postal_code: string | null;
  created_at?: string;
}

export interface Tier1RoomMetric {
  donor_id: string;
  device_id: string;
  room_ref: string | null;
  season: string; // e.g. "2026-summer"
  utgs_kh: number;
  hours_above_26: number;
  hours_above_28: number;
  hours_above_30: number;
  max_temp: number;
  tropical_nights: number;
  coverage_pct: number;
  last_updated?: string;
}

export interface Tier2PublicCohort {
  cohort_id: string; // e.g. spatial grid + season
  k_size: number;
  avg_utgs_kh: number;
  avg_hours_above_26: number;
  avg_max_temp: number;
  last_updated?: string;
}

export interface AuthSession {
  session_id: string;
  email: string;
  blinded_element: string;
  status: 'pending' | 'verified';
  evaluated_element: string | null;
  created_at?: string;
}

export interface DatabaseSchema {
  auth_sessions: AuthSession;
  readings: Reading;
  tier1_room_metrics: Tier1RoomMetric;
  tier2_public_cohorts: Tier2PublicCohort;
}

const sqlite = new Database('temperaturcrowd.db');

export const db = new Kysely<DatabaseSchema>({
  dialect: new BunSqliteDialect({
    database: sqlite,
  }),
});

// Initialize tables
export async function initDb() {
  await db.schema
    .createTable('auth_sessions')
    .ifNotExists()
    .addColumn('session_id', 'text', (cb) => cb.primaryKey())
    .addColumn('email', 'text', (cb) => cb.notNull())
    .addColumn('blinded_element', 'text', (cb) => cb.notNull())
    .addColumn('status', 'text', (cb) => cb.notNull().defaultTo('pending'))
    .addColumn('evaluated_element', 'text')
    .addColumn('created_at', 'timestamp', (cb) => cb.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('readings')
    .ifNotExists()
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement())
    .addColumn('device_id', 'text', (cb) => cb.notNull())
    .addColumn('donor_id', 'text', (cb) => cb.notNull())
    .addColumn('ts', 'text', (cb) => cb.notNull())
    .addColumn('temp_c', 'real', (cb) => cb.notNull())
    .addColumn('temp_c_min', 'real')
    .addColumn('temp_c_max', 'real')
    .addColumn('rh_pct', 'real')
    .addColumn('room_ref', 'text')
    .addColumn('postal_code', 'text')
    .addColumn('created_at', 'timestamp', (cb) => cb.defaultTo(sql`CURRENT_TIMESTAMP`))
    .addUniqueConstraint('readings_device_id_ts_unique', ['device_id', 'ts'])
    .execute();

  await db.schema
    .createTable('tier1_room_metrics')
    .ifNotExists()
    .addColumn('donor_id', 'text', (cb) => cb.notNull())
    .addColumn('device_id', 'text', (cb) => cb.notNull())
    .addColumn('room_ref', 'text')
    .addColumn('season', 'text', (cb) => cb.notNull())
    .addColumn('utgs_kh', 'real', (cb) => cb.notNull())
    .addColumn('hours_above_26', 'integer', (cb) => cb.notNull())
    .addColumn('hours_above_28', 'integer', (cb) => cb.notNull())
    .addColumn('hours_above_30', 'integer', (cb) => cb.notNull())
    .addColumn('max_temp', 'real', (cb) => cb.notNull())
    .addColumn('tropical_nights', 'integer', (cb) => cb.notNull())
    .addColumn('coverage_pct', 'real', (cb) => cb.notNull())
    .addColumn('last_updated', 'timestamp', (cb) => cb.defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint('pk_tier1', ['donor_id', 'device_id', 'season'])
    .execute();

  await db.schema
    .createTable('tier2_public_cohorts')
    .ifNotExists()
    .addColumn('cohort_id', 'text', (cb) => cb.primaryKey())
    .addColumn('k_size', 'integer', (cb) => cb.notNull())
    .addColumn('avg_utgs_kh', 'real', (cb) => cb.notNull())
    .addColumn('avg_hours_above_26', 'real', (cb) => cb.notNull())
    .addColumn('avg_max_temp', 'real', (cb) => cb.notNull())
    .addColumn('last_updated', 'timestamp', (cb) => cb.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();
}
