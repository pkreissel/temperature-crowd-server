import 'dotenv/config';
import { db } from '../src/db/index';

async function main() {
  const cohorts = await db.selectFrom('tier2_public_cohorts').selectAll().execute();
  
  for (const c of cohorts) {
    // Format: cohort_id \t room_count \t avg_utgs_kh \t avg_hours_above_26 \t avg_max_temp \t last_updated
    const out = [
      c.cohort_id,
      c.room_count,
      c.avg_utgs_kh.toFixed(2),
      c.avg_hours_above_26.toFixed(1),
      c.avg_max_temp.toFixed(1),
      c.last_updated ? new Date(c.last_updated).toLocaleString('de-DE') : new Date().toLocaleString('de-DE')
    ];
    console.log(out.join('\t'));
  }
  process.exit(0);
}

main().catch(console.error);
