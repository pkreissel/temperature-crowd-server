import { db } from './src/db/index';

async function migrate() {
  console.log('Running migration 2...');
  
  try {
    await db.schema
      .createTable('registered_phones')
      .ifNotExists()
      .addColumn('phone_hmac', 'text', (cb) => cb.primaryKey())
      .addColumn('created_at', 'timestamp')
      .execute();
    console.log('Created registered_phones table');
  } catch (err) {
    console.log('registered_phones error:', err);
  }
  
  console.log('Migration 2 complete.');
  process.exit(0);
}

migrate();
