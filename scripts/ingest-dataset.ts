/**
 * Phase 1: CSV -> Postgres ingest.
 *
 * Parses dataset/เนื้อเพลงลูกทุ่ง_1500.csv, cleans/normalizes the lyric
 * fields, and loads everything into the `songs` table (schema.sql),
 * rebuilding it from scratch each run (idempotent).
 *
 * Run: npx tsx --env-file=.env.local scripts/ingest-dataset.ts
 *   or: npm run ingest
 */
import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";
import { Pool } from "pg";
import { buildFullLyrics, cleanText, toSkeleton } from "../src/lib/search/normalize";

const CSV_PATH = "dataset/เนื้อเพลงลูกทุ่ง_1500.csv";
const BATCH_SIZE = 200;

interface CsvRow {
  title: string;
  field_artis: string;
  field_emotion: string;
  field_lyrics_chorus: string;
  field_lyrics_hook: string;
  field_lyrics_lead: string;
  field_year: string;
}

interface SongRecord {
  title: string;
  artist: string;
  year: number | null;
  emotion: string | null;
  lyrics_lead: string;
  lyrics_hook: string;
  lyrics_chorus: string;
  full_lyrics: string;
  lyrics_skeleton: string;
}

function toRecord(row: CsvRow): SongRecord {
  const lyrics_lead = cleanText(row.field_lyrics_lead);
  const lyrics_hook = cleanText(row.field_lyrics_hook);
  const lyrics_chorus = cleanText(row.field_lyrics_chorus);
  const full_lyrics = buildFullLyrics(lyrics_lead, lyrics_hook, lyrics_chorus);

  const yearNum = parseInt(row.field_year, 10);

  return {
    title: cleanText(row.title),
    artist: cleanText(row.field_artis),
    year: Number.isFinite(yearNum) ? yearNum : null,
    emotion: cleanText(row.field_emotion) || null,
    lyrics_lead,
    lyrics_hook,
    lyrics_chorus,
    full_lyrics,
    lyrics_skeleton: toSkeleton(full_lyrics),
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Run with: npx tsx --env-file=.env.local scripts/ingest-dataset.ts");
    process.exit(1);
  }

  console.log(`Reading ${CSV_PATH} ...`);
  const raw = readFileSync(CSV_PATH, "utf8");
  const rows: CsvRow[] = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });
  console.log(`Parsed ${rows.length} rows.`);

  const records = rows.map(toRecord);

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    console.log("Applying schema (scripts/schema.sql) ...");
    const schemaSql = readFileSync("scripts/schema.sql", "utf8");
    await client.query(schemaSql);

    await client.query("BEGIN");
    console.log("Truncating songs table ...");
    await client.query("TRUNCATE TABLE songs RESTART IDENTITY");

    const columns = [
      "title",
      "artist",
      "year",
      "emotion",
      "lyrics_lead",
      "lyrics_hook",
      "lyrics_chorus",
      "full_lyrics",
      "lyrics_skeleton",
    ] as const;

    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      const values: unknown[] = [];
      const rowPlaceholders = batch.map((rec) => {
        const placeholders = columns.map((col) => {
          values.push(rec[col]);
          return `$${values.length}`;
        });
        return `(${placeholders.join(", ")})`;
      });

      const insertSql = `INSERT INTO songs (${columns.join(", ")}) VALUES ${rowPlaceholders.join(", ")}`;
      await client.query(insertSql, values);
      inserted += batch.length;
      console.log(`  inserted ${inserted}/${records.length}`);
    }

    await client.query("COMMIT");

    const { rows: countRows } = await client.query("SELECT count(*)::int AS count FROM songs");
    console.log(`Done. songs table now has ${countRows[0].count} rows.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});
