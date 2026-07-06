import { db } from '../src/db/index';
import { sql } from 'kysely';

async function resetDb() {
  console.log('Resetting the database...');
  
  // Note: kysely-libsql doesn't natively expose a generic schema dropper for SQLite easily,
  // so we'll fetch all tables and drop them.
  const tables = await db.introspection.getTables();
  
  for (const table of tables) {
    if (table.name !== 'sqlite_sequence') {
      console.log(`Dropping table ${table.name}...`);
      await db.schema.dropTable(table.name).ifExists().execute();
    }
  }

  // Drop the kysely migrations tables specifically
  await db.schema.dropTable('kysely_migration').ifExists().execute();
  await db.schema.dropTable('kysely_migration_lock').ifExists().execute();

  console.log('Database successfully reset. You can now start the server to run the initial migration.');
  process.exit(0);
}

resetDb().catch((err) => {
  console.error('Failed to reset database', err);
  process.exit(1);
});
