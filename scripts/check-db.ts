// Phase 0 sanity check: verify DATABASE_URL connects and pg_trgm is enabled.
// Run: npx tsx --env-file=.env.local scripts/check-db.ts
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (check .env.local)");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });

  try {
    await client.connect();
    const ping = await client.query("SELECT 1 as ok");
    console.log("Connection OK:", ping.rows[0]);

    const ext = await client.query(
      "SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm'"
    );
    if (ext.rows.length === 0) {
      console.error("pg_trgm is NOT enabled. Run: CREATE EXTENSION IF NOT EXISTS pg_trgm;");
      process.exitCode = 1;
    } else {
      console.log("pg_trgm enabled:", ext.rows[0]);
    }
  } catch (err) {
    console.error("Connection FAILED:", (err as Error).message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
