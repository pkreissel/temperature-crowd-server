import { db } from './src/db/index';

async function migrate() {
  console.log('Running migration...');
  
  try {
    await db.schema.alterTable('auth_sessions').addColumn('attempts', 'integer', (cb) => cb.notNull().defaultTo(0)).execute();
    console.log('Added attempts column');
  } catch (err) {
    console.log('attempts column might already exist:', err);
  }

  try {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.schema.alterTable('auth_sessions').addColumn('expires_at', 'text', (cb) => cb.notNull().defaultTo(expiresAt)).execute();
    console.log('Added expires_at column');
  } catch (err) {
    console.log('expires_at column might already exist:', err);
  }
  
  console.log('Migration complete.');
  process.exit(0);
}

migrate();
