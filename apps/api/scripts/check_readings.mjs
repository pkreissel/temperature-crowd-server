import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.DATABASE_URL || 'file:temperaturcrowd.db',
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const q = async (sql) => (await db.execute(sql)).rows;

const [summary] = await q(`
  SELECT
    count(*)                   AS total,
    count(DISTINCT device_id)  AS devices,
    count(DISTINCT donor_id)   AS donors,
    max(created_at)            AS last_inserted,
    max(ts)                    AS latest_ts,
    min(ts)                    AS earliest_ts
  FROM readings
`);

console.log('=== readings summary ===');
console.table([summary]);

console.log('\n=== 5 most recently inserted rows ===');
const recent = await q(`
  SELECT id, device_id, ts, temp_c, temp_c_min, temp_c_max, created_at
  FROM readings
  ORDER BY created_at DESC, id DESC
  LIMIT 5
`);
console.table(recent);

console.log('\n=== inserts per hour (last 12h buckets by created_at) ===');
const perHour = await q(`
  SELECT substr(created_at, 1, 13) AS hour_bucket, count(*) AS rows
  FROM readings
  GROUP BY hour_bucket
  ORDER BY hour_bucket DESC
  LIMIT 12
`);
console.table(perHour);

process.exit(0);
