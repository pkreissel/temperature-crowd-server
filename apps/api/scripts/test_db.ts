import { db } from '../src/db/index';

async function main() {
  const cohorts = await db.selectFrom('tier2_public_cohorts').selectAll().execute();
  console.log("Cohorts:", cohorts);
}
main().catch(console.error);
