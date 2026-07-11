import { Kysely } from 'kysely';

// Columns needed by the reworked recompute job (ADR-0002 companion metrics + ADR-0003
// per-cell k-anon). Added nullable — the recompute rebuilds both tiers from scratch on the
// next run, so no backfill is required.

export async function up(db: Kysely<any>): Promise<void> {
  // Tier 1: climate region actually used, and the peak (hourly-max) ÜTGS variant.
  await db.schema
    .alterTable('tier1_room_metrics')
    .addColumn('region', 'text')
    .execute();
  await db.schema
    .alterTable('tier1_room_metrics')
    .addColumn('utgs_kh_peak', 'real')
    .execute();

  // Tier 2: identify the published cell/season/level and carry the full companion-metric set.
  await db.schema.alterTable('tier2_public_cohorts').addColumn('cell', 'text').execute();
  await db.schema.alterTable('tier2_public_cohorts').addColumn('season', 'text').execute();
  await db.schema.alterTable('tier2_public_cohorts').addColumn('grid_level', 'text').execute();
  await db.schema.alterTable('tier2_public_cohorts').addColumn('region', 'text').execute();
  await db.schema.alterTable('tier2_public_cohorts').addColumn('room_count', 'integer').execute();
  await db.schema.alterTable('tier2_public_cohorts').addColumn('avg_utgs_kh_peak', 'real').execute();
  await db.schema.alterTable('tier2_public_cohorts').addColumn('avg_hours_above_28', 'real').execute();
  await db.schema.alterTable('tier2_public_cohorts').addColumn('avg_hours_above_30', 'real').execute();
  await db.schema.alterTable('tier2_public_cohorts').addColumn('avg_tropical_nights', 'real').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('tier1_room_metrics').dropColumn('region').execute();
  await db.schema.alterTable('tier1_room_metrics').dropColumn('utgs_kh_peak').execute();
  await db.schema.alterTable('tier2_public_cohorts').dropColumn('cell').execute();
  await db.schema.alterTable('tier2_public_cohorts').dropColumn('season').execute();
  await db.schema.alterTable('tier2_public_cohorts').dropColumn('grid_level').execute();
  await db.schema.alterTable('tier2_public_cohorts').dropColumn('region').execute();
  await db.schema.alterTable('tier2_public_cohorts').dropColumn('room_count').execute();
  await db.schema.alterTable('tier2_public_cohorts').dropColumn('avg_utgs_kh_peak').execute();
  await db.schema.alterTable('tier2_public_cohorts').dropColumn('avg_hours_above_28').execute();
  await db.schema.alterTable('tier2_public_cohorts').dropColumn('avg_hours_above_30').execute();
  await db.schema.alterTable('tier2_public_cohorts').dropColumn('avg_tropical_nights').execute();
}
