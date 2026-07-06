import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('auth_sessions')
    .ifNotExists()
    .addColumn('session_id', 'text', (cb) => cb.primaryKey())
    .addColumn('phone_hmac', 'text', (cb) => cb.notNull())
    .addColumn('otp_code', 'text', (cb) => cb.notNull())
    .addColumn('blinded_element', 'text', (cb) => cb.notNull())
    .addColumn('status', 'text', (cb) => cb.notNull().defaultTo('pending'))
    .addColumn('evaluated_element', 'text')
    .addColumn('attempts', 'integer', (cb) => cb.notNull().defaultTo(0))
    .addColumn('expires_at', 'text', (cb) => cb.notNull())
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

  await db.schema
    .createTable('donor_metadata')
    .ifNotExists()
    .addColumn('donor_id', 'text', (cb) => cb.primaryKey())
    .addColumn('building_age', 'text')
    .addColumn('floor_level', 'text')
    .addColumn('orientation', 'text')
    .addColumn('insulation_status', 'text')
    .addColumn('updated_at', 'timestamp', (cb) => cb.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('registered_phones')
    .ifNotExists()
    .addColumn('phone_hmac', 'text', (cb) => cb.primaryKey())
    .addColumn('created_at', 'timestamp', (cb) => cb.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('registered_phones').ifExists().execute();
  await db.schema.dropTable('donor_metadata').ifExists().execute();
  await db.schema.dropTable('tier2_public_cohorts').ifExists().execute();
  await db.schema.dropTable('tier1_room_metrics').ifExists().execute();
  await db.schema.dropTable('readings').ifExists().execute();
  await db.schema.dropTable('auth_sessions').ifExists().execute();
}
