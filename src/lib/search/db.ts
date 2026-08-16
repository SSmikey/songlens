import { Pool } from "pg";

let pool: Pool | undefined;

/** Lazily-created singleton pg Pool, reused across requests/hot-reloads. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set (check .env.local)");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}
