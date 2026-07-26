import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN!,
});

async function main() {
  try {
    console.log("Connecting to database at:", process.env.DATABASE_URL);
    const rs = await db.execute("SELECT 1 as connected");
    console.log("Connection successful!");
    console.log(rs.rows);
  } catch (err) {
    console.error("Failed to connect:", err);
  }
}

main();
