import { Kysely, sql } from 'kysely';

// The `readings` unique key was (device_id, ts) only, so two rooms reporting for the same
// device at the same hour collided and silently overwrote each other, keeping just one room's
// reading per hour (see ingest.ts). Widen the key to (device_id, ts, room_ref) so each monitored
// sensor gets its own row. SQLite/libSQL can't ALTER a UNIQUE constraint in place, so the table
// is recreated; the new key is strictly looser than the old one (a superset of columns), so
// every existing row already satisfies it and the copy can't hit a conflict.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE readings RENAME TO readings_old`.execute(db);

  await db.schema
    .createTable('readings')
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement())
    .addColumn('device_id', 'text', (cb) => cb.notNull())
    .addColumn('donor_id', 'text', (cb) => cb.notNull())
    .addColumn('ts', 'text', (cb) => cb.notNull())
    .addColumn('temp_c', 'real', (cb) => cb.notNull())
    .addColumn('temp_c_min', 'real')
    .addColumn('temp_c_max', 'real')
    .addColumn('room_ref', 'text')
    .addColumn('postal_code', 'text')
    .addColumn('created_at', 'timestamp', (cb) => cb.defaultTo(sql`CURRENT_TIMESTAMP`))
    .addUniqueConstraint('readings_device_id_ts_room_ref_unique', ['device_id', 'ts', 'room_ref'])
    .execute();

  await sql`
    INSERT INTO readings (id, device_id, donor_id, ts, temp_c, temp_c_min, temp_c_max, room_ref, postal_code, created_at)
    SELECT id, device_id, donor_id, ts, temp_c, temp_c_min, temp_c_max, room_ref, postal_code, created_at
    FROM readings_old
  `.execute(db);

  await sql`DROP TABLE readings_old`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE readings RENAME TO readings_new`.execute(db);

  await db.schema
    .createTable('readings')
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement())
    .addColumn('device_id', 'text', (cb) => cb.notNull())
    .addColumn('donor_id', 'text', (cb) => cb.notNull())
    .addColumn('ts', 'text', (cb) => cb.notNull())
    .addColumn('temp_c', 'real', (cb) => cb.notNull())
    .addColumn('temp_c_min', 'real')
    .addColumn('temp_c_max', 'real')
    .addColumn('room_ref', 'text')
    .addColumn('postal_code', 'text')
    .addColumn('created_at', 'timestamp', (cb) => cb.defaultTo(sql`CURRENT_TIMESTAMP`))
    .addUniqueConstraint('readings_device_id_ts_unique', ['device_id', 'ts'])
    .execute();

  await sql`
    INSERT INTO readings (id, device_id, donor_id, ts, temp_c, temp_c_min, temp_c_max, room_ref, postal_code, created_at)
    SELECT id, device_id, donor_id, ts, temp_c, temp_c_min, temp_c_max, room_ref, postal_code, created_at
    FROM readings_new
  `.execute(db);

  await sql`DROP TABLE readings_new`.execute(db);
}
