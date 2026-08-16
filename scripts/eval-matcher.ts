/**
 * Phase 2 acceptance test: simulate STT-mangled queries against the real
 * dataset and measure how often searchLyrics() finds the correct song.
 *
 * Run: npx tsx --env-file=.env.local scripts/eval-matcher.ts
 */
import { Pool } from "pg";
import { searchLyrics } from "../src/lib/search/matcher";
import { toSkeleton } from "../src/lib/search/normalize";

const TRIALS = 60;
const SNIPPET_MIN = 15;
const SNIPPET_MAX = 30;

// Thai consonants commonly confused by ear / casual spelling / STT.
const CONFUSION_MAP: Record<string, string> = {
  "ท": "ธ", "ธ": "ท",
  "ส": "ศ", "ศ": "ษ", "ษ": "ส",
  "ณ": "น", "น": "ณ",
  "ฎ": "ด", "ด": "ฎ",
  "ฏ": "ต", "ต": "ฏ",
  "ค": "ข", "ข": "ค",
  "ร": "ล", "ล": "ร",
  "ช": "ฉ", "ฉ": "ช",
};

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickSnippet(fullLyrics: string): string {
  const len = randInt(SNIPPET_MIN, SNIPPET_MAX);
  const maxStart = Math.max(0, fullLyrics.length - len);
  const start = randInt(0, maxStart);
  return fullLyrics.slice(start, start + len);
}

function substituteConsonants(s: string, count: number): string {
  const chars = [...s];
  const candidates = chars
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => CONFUSION_MAP[c]);
  for (let n = 0; n < count && candidates.length > 0; n++) {
    const idx = randInt(0, candidates.length - 1);
    const { i, c } = candidates.splice(idx, 1)[0];
    chars[i] = CONFUSION_MAP[c];
  }
  return chars.join("");
}

function deleteRandomChars(s: string, count: number): string {
  const chars = [...s];
  for (let n = 0; n < count && chars.length > 3; n++) {
    chars.splice(randInt(0, chars.length - 1), 1);
  }
  return chars.join("");
}

/** Produce a query that plausibly resembles what STT would output for this snippet. */
function mangle(snippet: string): string {
  let s = snippet;
  const roll = Math.random();
  if (roll < 0.4) {
    // simulate tone/vowel drift
    s = toSkeleton(s);
  } else if (roll < 0.7) {
    s = substituteConsonants(s, randInt(1, 2));
  } else {
    s = deleteRandomChars(s, randInt(1, 2));
  }
  // occasionally also drop/blur a space, independent of the above
  if (Math.random() < 0.3) {
    s = s.replace(" ", "");
  }
  return s;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows: songs } = await pool.query<{ id: number; title: string; full_lyrics: string }>(
    "SELECT id, title, full_lyrics FROM songs WHERE length(full_lyrics) >= $1",
    [SNIPPET_MAX]
  );
  console.log(`Loaded ${songs.length} candidate songs for evaluation.`);

  let top1 = 0;
  let top5 = 0;
  const failures: { title: string; query: string; got: string[] }[] = [];

  for (let t = 0; t < TRIALS; t++) {
    const song = songs[randInt(0, songs.length - 1)];
    const snippet = pickSnippet(song.full_lyrics);
    const query = mangle(snippet);

    const results = await searchLyrics(query, 5);
    const ids = results.map((r) => r.id);
    const rank = ids.indexOf(song.id);

    if (rank === 0) top1++;
    if (rank !== -1) top5++;
    else failures.push({ title: song.title, query, got: results.map((r) => r.title) });
  }

  console.log(`\nTrials: ${TRIALS}`);
  console.log(`accuracy@1: ${((top1 / TRIALS) * 100).toFixed(1)}%`);
  console.log(`accuracy@5: ${((top5 / TRIALS) * 100).toFixed(1)}%`);

  if (failures.length > 0) {
    console.log(`\n--- ${failures.length} misses (not in top-5) ---`);
    for (const f of failures.slice(0, 15)) {
      console.log(`expected "${f.title}" | query "${f.query}" | got: ${f.got.join(", ")}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
