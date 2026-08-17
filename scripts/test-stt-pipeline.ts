/**
 * Phase 3 smoke test: TTS (OpenAI) -> STT (Whisper) -> searchLyrics().
 *
 * No microphone available in this environment, so we synthesize clear Thai
 * speech from real lyric snippets in the dataset as a stand-in for "a user
 * speaking clearly." This proves the transcribe() plumbing + Thai accuracy
 * end-to-end. It is NOT a substitute for testing with real recorded/sung
 * audio (noisy mic, singing cadence, etc.) — that's Phase 6 scope.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-stt-pipeline.ts
 */
import OpenAI from "openai";
import { Pool } from "pg";
import { createWhisperProvider } from "../src/lib/stt/whisper";
import { searchLyrics } from "../src/lib/search/matcher";

const SAMPLE_COUNT = 5;
const SNIPPET_LEN = 60; // longer than eval-matcher's snippets: give TTS a full phrase to say

function randInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const whisper = createWhisperProvider();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows: songs } = await pool.query<{ id: number; title: string; full_lyrics: string }>(
    `SELECT id, title, full_lyrics FROM songs WHERE length(full_lyrics) >= $1 ORDER BY random() LIMIT $2`,
    [SNIPPET_LEN, SAMPLE_COUNT]
  );

  let ttsOk = 0;
  let top1 = 0;
  let top5 = 0;

  for (const song of songs) {
    const start = randInt(0, song.full_lyrics.length - SNIPPET_LEN);
    const snippet = song.full_lyrics.slice(start, start + SNIPPET_LEN);

    console.log(`\n=== "${song.title}" ===`);
    console.log(`spoken text : ${snippet}`);

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: snippet,
      response_format: "mp3",
    });
    const arrayBuffer = await speech.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    ttsOk++;

    const transcript = await whisper.transcribe({
      buffer,
      filename: "clip.mp3",
      mimeType: "audio/mpeg",
    });
    console.log(`STT output  : ${transcript}`);

    const results = await searchLyrics(transcript, 5);
    const rank = results.findIndex((r) => r.id === song.id);
    console.log(
      `search result: ${rank === 0 ? "TOP-1 ✅" : rank > 0 ? `top-5 (#${rank + 1}) ⚠️` : "MISS ❌"}` +
        (results[0] ? ` (best guess: "${results[0].title}", score ${results[0].score.toFixed(3)})` : "")
    );

    if (rank === 0) top1++;
    if (rank !== -1) top5++;
  }

  console.log(`\n--- summary (n=${songs.length}) ---`);
  console.log(`TTS generated: ${ttsOk}/${songs.length}`);
  console.log(`search top-1 : ${top1}/${songs.length}`);
  console.log(`search top-5 : ${top5}/${songs.length}`);

  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
