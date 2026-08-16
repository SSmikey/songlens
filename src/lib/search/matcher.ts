import { getPool } from "./db";
import { cleanText, toSkeleton } from "./normalize";

export interface SearchResult {
  id: number;
  title: string;
  artist: string;
  year: number | null;
  emotion: string | null;
  score: number;
  snippet: string;
}

// Weighted blend of two word_similarity signals:
//  - full_lyrics: as-written text, catches queries STT got mostly right
//  - lyrics_skeleton: tone marks/vowel diacritics stripped, catches queries
//    where STT heard the right consonants but the wrong tone/vowel
const WEIGHT_FULL = 0.6;
const WEIGHT_SKELETON = 0.4;

// Below this blended score, a "match" is more likely noise than signal —
// callers should treat an empty/low-score result set as "not found" rather
// than showing the nearest-but-wrong song.
//
// Empirically measured (scripts/eval-matcher.ts + a manual unrelated-text
// probe): queries with no real match in the dataset scored 0.17-0.22
// against their best (still wrong) candidate, while true matches from
// mangled real lyrics scored p10=0.445 / median=0.57. 0.30 sits in the
// gap between those two distributions with margin on both sides.
export const MIN_SCORE_THRESHOLD = 0.3;

/**
 * Rank all songs by how well `queryText` (typically a raw-ish STT
 * transcript) matches their lyrics, using pg_trgm's word_similarity —
 * which scores a short query against the best-matching extent of a long
 * document, rather than the whole document at once (plain `similarity()`
 * was tried first and ranked poorly for exactly this reason, see
 * docs/PLAN.md Phase 1 notes).
 */
export async function searchLyrics(queryText: string, limit = 5): Promise<SearchResult[]> {
  const query = cleanText(queryText);
  if (!query) return [];
  const skeletonQuery = toSkeleton(query);

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
        id, title, artist, year, emotion, full_lyrics,
        word_similarity($1, full_lyrics) AS full_score,
        word_similarity($2, lyrics_skeleton) AS skeleton_score,
        ($3 * word_similarity($1, full_lyrics) + $4 * word_similarity($2, lyrics_skeleton)) AS score
     FROM songs
     ORDER BY score DESC
     LIMIT $5`,
    [query, skeletonQuery, WEIGHT_FULL, WEIGHT_SKELETON, limit]
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    year: row.year,
    emotion: row.emotion,
    score: Number(row.score),
    snippet: extractSnippet(row.full_lyrics, query),
  }));
}

// --- snippet extraction -----------------------------------------------
// word_similarity tells us THAT a document matches, not WHERE. To show a
// highlighted excerpt we do a cheap sliding-window trigram comparison in
// JS, but only over the handful of rows actually returned (never over all
// 1,500 songs), so the cost is negligible.

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `; // pg_trgm-style edge padding so short strings still yield trigrams
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return (2 * intersection) / (a.size + b.size);
}

const SNIPPET_CONTEXT_CHARS = 25;

export function extractSnippet(fullText: string, query: string): string {
  if (!fullText) return "";
  const queryTrigrams = trigrams(query);
  const windowSize = Math.max(query.length, 10);
  const stride = Math.max(1, Math.floor(windowSize / 4));

  let bestScore = -1;
  let bestStart = 0;
  for (let start = 0; start <= Math.max(0, fullText.length - windowSize); start += stride) {
    const window = fullText.slice(start, start + windowSize);
    const score = diceCoefficient(queryTrigrams, trigrams(window));
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  const from = Math.max(0, bestStart - SNIPPET_CONTEXT_CHARS);
  const to = Math.min(fullText.length, bestStart + windowSize + SNIPPET_CONTEXT_CHARS);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < fullText.length ? "…" : "";
  return `${prefix}${fullText.slice(from, to)}${suffix}`;
}
