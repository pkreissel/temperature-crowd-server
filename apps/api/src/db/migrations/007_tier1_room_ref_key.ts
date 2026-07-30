import { Kysely, sql } from 'kysely';

// tier1_room_metrics was keyed (donor_id, device_id, season), so a donor with more than one
// monitored room could only ever get one row per device per season — sql_aggregations.ts
// grouped by (donor_id, device_id) and picked an arbitrary room via MAX(room_ref), silently
// collapsing every other room's metrics. Widen the key to include room_ref so each room gets
// its own row. tier1_room_metrics is a fully derived table (rebuilt wholesale by the recompute
// job, see recompute.ts's persistTiers), so existing rows are stale the moment this ships
// anyway; the copy below is just to avoid a window with an empty table before recompute next
// runs. The new key is a superset of the old one, so existing rows can't conflict.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE tier1_room_metrics RENAME TO tier1_room_metrics_old`.execute(db);

  await db.schema
    .createTable('tier1_room_metrics')
    .addColumn('donor_id', 'text', (cb) => cb.notNull())
    .addColumn('device_id', 'text', (cb) => cb.notNull())
    .addColumn('room_ref', 'text')
    .addColumn('season', 'text', (cb) => cb.notNull())
    .addColumn('region', 'text')
    .addColumn('utgs_kh_peak', 'real')
    .addColumn('utgs_kh', 'real', (cb) => cb.notNull())
    .addColumn('hours_above_26', 'integer', (cb) => cb.notNull())
    .addColumn('hours_above_28', 'integer', (cb) => cb.notNull())
    .addColumn('hours_above_30', 'integer', (cb) => cb.notNull())
    .addColumn('max_temp', 'real', (cb) => cb.notNull())
    .addColumn('tropical_nights', 'integer', (cb) => cb.notNull())
    .addColumn('coverage_pct', 'real', (cb) => cb.notNull())
    .addColumn('last_updated', 'timestamp', (cb) => cb.defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint('pk_tier1', ['donor_id', 'device_id', 'room_ref', 'season'])
    .execute();

  await sql`
    INSERT INTO tier1_room_metrics (donor_id, device_id, room_ref, season, region, utgs_kh_peak,
      utgs_kh, hours_above_26, hours_above_28, hours_above_30, max_temp, tropical_nights,
      coverage_pct, last_updated)
    SELECT donor_id, device_id, room_ref, season, region, utgs_kh_peak,
      utgs_kh, hours_above_26, hours_above_28, hours_above_30, max_temp, tropical_nights,
      coverage_pct, last_updated
    FROM tier1_room_metrics_old
  `.execute(db);

  await sql`DROP TABLE tier1_room_metrics_old`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE tier1_room_metrics RENAME TO tier1_room_metrics_new`.execute(db);

  await db.schema
    .createTable('tier1_room_metrics')
    .addColumn('donor_id', 'text', (cb) => cb.notNull())
    .addColumn('device_id', 'text', (cb) => cb.notNull())
    .addColumn('room_ref', 'text')
    .addColumn('season', 'text', (cb) => cb.notNull())
    .addColumn('region', 'text')
    .addColumn('utgs_kh_peak', 'real')
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

  await sql`
    INSERT INTO tier1_room_metrics (donor_id, device_id, room_ref, season, region, utgs_kh_peak,
      utgs_kh, hours_above_26, hours_above_28, hours_above_30, max_temp, tropical_nights,
      coverage_pct, last_updated)
    SELECT donor_id, device_id, room_ref, season, region, utgs_kh_peak,
      utgs_kh, hours_above_26, hours_above_28, hours_above_30, max_temp, tropical_nights,
      coverage_pct, last_updated
    FROM tier1_room_metrics_new
    GROUP BY donor_id, device_id, season
  `.execute(db);

  await sql`DROP TABLE tier1_room_metrics_new`.execute(db);
}
