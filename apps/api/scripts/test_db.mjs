import { createClient } from '@libsql/client';

const dbUrl = "libsql://01KWEK6MMBMMDMF70C85CJRK15-temperaturecrowd.lite.bunnydb.net/";
const authToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJFZERTQSJ9.eyJwIjp7InJvIjpudWxsLCJydyI6eyJucyI6WyJ0ZW1wZXJhdHVyZWNyb3dkIl0sInRhZ3MiOm51bGx9LCJyb2EiOm51bGwsInJ3YSI6bnVsbCwiZGRsIjpudWxsfSwiaWF0IjoxNzgyOTAxMzMyfQ.PymPw1SCzQjT-v0fT0rIYse-_5NXm9mN8R3UliF1qzLV2qCydHYqzlMaI3AlTehb2bckriZeQX2TqaG-m8vCBA";

const client = createClient({
  url: dbUrl,
  authToken: authToken,
});

async function main() {
  const rs = await client.execute("SELECT * FROM tier2_public_cohorts");
  console.log("Cohorts:", rs.rows);
}
main().catch(console.error);
