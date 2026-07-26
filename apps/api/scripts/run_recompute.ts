import 'dotenv/config';
import { initDb } from '../src/db/index';
import { runRecomputeJob } from '../src/jobs/recompute';

async function main() {
  try {
    await initDb();
    console.log('Database initialized, running job...');
    await runRecomputeJob();
    console.log('Job finished successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Job failed:', err);
    process.exit(1);
  }
}

main();
