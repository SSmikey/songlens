/**
 * Client-side STT via the browser's native Web Speech API
 * (SpeechRecognition / webkitSpeechRecognition). Free, no API key, no
 * server round-trip for audio — this is the primary STT path for the app.
 *
 * Browser support: Chrome/Edge (desktop + Android) implement this well.
 * Firefox and Safari/iOS do not support it reliably — isSupported() lets
 * callers detect that and fall back to manual text entry (or, later, to
 * the server-side src/lib/stt/whisper.ts provider if broader support is
 * ever worth the OpenAI cost).
 *
 * Only call these functions from Client Components (`"use client"`).
 */

// Minimal local shape of what we actually use from the Web Speech API —
// avoids depending on ambient lib.dom types for these (non-standard,
// vendor-prefixed) APIs, which aren't reliably present across TS/lib
// versions.
interface MinimalSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  abort(): void;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => MinimalSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function isSpeechRecognitionSupported(): boolean {
  return Boolean(getSpeechRecognitionCtor());
}

export type ListenErrorReason =
  | "unsupported" // browser has no SpeechRecognition implementation
  | "no-speech" // recognizer ended without hearing anything
  | "not-allowed" // mic permission denied
  | "audio-capture" // no mic available
  | "network" // recognizer's network call failed
  | "aborted" // caller/timeout aborted it
  | "unknown";

export class ListenError extends Error {
  constructor(public reason: ListenErrorReason, message?: string) {
    super(message ?? reason);
    this.name = "ListenError";
  }
}

/**
 * Listen for a single Thai utterance and resolve with the recognized text.
 * Rejects with a ListenError on failure (including simply "no-speech").
 */
export function listenOnce(options?: { timeoutMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      reject(new ListenError("unsupported", "This browser does not support SpeechRecognition"));
      return;
    }

    const recognition = new Ctor();
    recognition.lang = "th-TH";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    let settled = false;
    const timeoutMs = options?.timeoutMs ?? 10_000;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      recognition.abort();
      reject(new ListenError("aborted", "Listening timed out"));
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    recognition.onresult = (event) => {
      finish(() => {
        const transcript = event.results?.[0]?.[0]?.transcript ?? "";
        resolve(transcript);
      });
    };

    recognition.onerror = (event) => {
      finish(() => {
        const knownReasons: ListenErrorReason[] = [
          "no-speech",
          "not-allowed",
          "audio-capture",
          "network",
          "aborted",
        ];
        const reason: ListenErrorReason = knownReasons.includes(event.error as ListenErrorReason)
          ? (event.error as ListenErrorReason)
          : "unknown";
        reject(new ListenError(reason, event.error));
      });
    };

    // Fires if recognition stops without a result and without an explicit
    // error event (e.g. genuine silence) — treat as "no-speech".
    recognition.onend = () => {
      finish(() => reject(new ListenError("no-speech")));
    };

    try {
      recognition.start();
    } catch (err) {
      finish(() => reject(new ListenError("unknown", err instanceof Error ? err.message : String(err))));
    }
  });
}
