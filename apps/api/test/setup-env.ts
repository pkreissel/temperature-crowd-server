import dotenv from 'dotenv';

// Runs before any test file (and therefore before src/index.ts's `import 'dotenv/config'`)
// so DATABASE_URL is already set to a local file by the time anything else loads. dotenv's
// default config() call never overrides variables that are already in process.env, so this
// wins even though .env.test is normally the lower-priority file.
dotenv.config({ path: '.env.test', override: true });
