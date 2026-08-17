import OpenAI, { toFile } from "openai";
import type { SttProvider, TranscribeInput } from "./types";

// gpt-4o-transcribe is OpenAI's current general-purpose transcription model
// (successor to whisper-1) — overridable via env in case whisper-1 or a
// newer model turns out more accurate for Thai during Phase 6 tuning.
const DEFAULT_MODEL = process.env.STT_MODEL ?? "gpt-4o-transcribe";

export function createWhisperProvider(apiKey = process.env.OPENAI_API_KEY): SttProvider {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set (check .env.local)");
  }
  const client = new OpenAI({ apiKey });

  return {
    async transcribe({ buffer, filename, mimeType }: TranscribeInput): Promise<string> {
      const file = await toFile(buffer, filename, mimeType ? { type: mimeType } : undefined);

      const transcription = await client.audio.transcriptions.create({
        file,
        model: DEFAULT_MODEL,
        language: "th",
      });

      return transcription.text.trim();
    },
  };
}
