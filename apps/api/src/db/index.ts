import { createClient } from '@libsql/client';
import { Kysely } from 'kysely';
import { LibsqlDialect } from '@libsql/kysely-libsql';

export interface Reading {
  id?: number;
  device_id: string;
  donor_id: string;
  ts: string;
  temp_c: number;
  temp_c_min: number | null;
  temp_c_max: number | null;
  room_ref: string | null;
  postal_code: string | null;
  created_at?: string;
}

export interface Tier1RoomMetric {
  donor_id: string;
  device_id: string;
  room_ref: string | null;
  season: string; // e.g. "2026-summer"
  region: 'A' | 'B' | 'C' | null; // climate region actually applied (ADR-0002/0005)
  utgs_kh: number; // ÜTGS on the hourly mean
  utgs_kh_peak: number | null; // ÜTGS on the hourly max (bounds averaging under-count)
  hours_above_26: number;
  hours_above_28: number;
  hours_above_30: number;
  max_temp: number;
  tropical_nights: number;
  coverage_pct: number;
  last_updated?: string;
}

export interface Tier2PublicCohort {
  cohort_id: string; // `${cell}|${season}` — the primary key
  cell: string | null; // published grid cell, e.g. "plz3:603" or "de:DE"
  season: string | null; // e.g. "2026-summer"
  grid_level: string | null; // plz5 | plz3 | plz1 | de (level the cell was published at)
  region: 'A' | 'B' | 'C' | null; // dominant climate region within the cell
  k_size: number; // distinct donors in the cell (>= k threshold, enforced at build)
  room_count: number | null; // rooms aggregated (>= k_size)
  avg_utgs_kh: number;
  avg_utgs_kh_peak: number | null;
  avg_hours_above_26: number;
  avg_hours_above_28: number | null;
  avg_hours_above_30: number | null;
  avg_max_temp: number;
  avg_tropical_nights: number | null;
  last_updated?: string;
}

export interface AuthSession {
  session_id: string;
  phone_hmac: string;
  otp_code: string;
  blinded_element: string;
  status: 'pending' | 'verified';
  blind_signature: string | null; // server's RFC 9474 blind signature over blinded_element
  attempts: number;
  expires_at: string;
  created_at?: string;
}

export interface DonorMetadata {
  donor_id: string;
  building_age: string | null;
  floor_level: string | null;
  orientation: string | null;
  insulation_status: string | null;
  updated_at?: string;
}

export interface RegisteredPhone {
  phone_hmac: string;
  created_at?: string;
}

export interface DatabaseSchema {
  auth_sessions: AuthSession;
  readings: Reading;
  tier1_room_metrics: Tier1RoomMetric;
  tier2_public_cohorts: Tier2PublicCohort;
  donor_metadata: DonorMetadata;
  registered_phones: RegisteredPhone;
}

const dbUrl = process.env.DATABASE_URL || 'file:temperaturcrowd.db';

const libsqlClient = createClient({
  url: dbUrl,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

export const db = new Kysely<DatabaseSchema>({
  dialect: new LibsqlDialect({
    client: libsqlClient as any,
  }),
});

import * as path from 'path';
import { promises as fs } from 'fs';
import { Migrator, FileMigrationProvider } from 'kysely/migration';

export async function initDb() {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  if (error) {
    console.error('Failed to migrate');
    console.error(error);
    process.exit(1);
  }

  if (results) {
    for (const it of results) {
      if (it.status === 'Success') {
        console.log(`Migration "${it.migrationName}" was executed successfully`);
      } else if (it.status === 'Error') {
        console.error(`Failed to execute migration "${it.migrationName}"`);
      }
    }
  }
}
