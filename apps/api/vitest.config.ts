import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup-env.ts'],
    // Every DB-touching suite calls initDb() against the same .env.test SQLite file, and
    // concurrent migrations on one file give SQLITE_BUSY ("database is locked"). The suite is
    // seconds long, so serialising files is cheaper than giving each one its own database.
    fileParallelism: false,
  },
});
