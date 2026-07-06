import { Kysely } from 'kysely';

// Rename the auth-session column from the OPRF-era `evaluated_element` to `blind_signature`,
// the RFC 9474 term for the server's blind signature over the blinded element (ADR-0004).

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('auth_sessions')
    .renameColumn('evaluated_element', 'blind_signature')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('auth_sessions')
    .renameColumn('blind_signature', 'evaluated_element')
    .execute();
}
