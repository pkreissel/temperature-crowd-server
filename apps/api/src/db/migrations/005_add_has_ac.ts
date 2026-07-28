import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('donor_metadata')
    .addColumn('has_ac', 'integer')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('donor_metadata')
    .dropColumn('has_ac')
    .execute();
}
