/** Raw audio to be transcribed, in whatever container the caller has on hand. */
export interface TranscribeInput {
  /** Raw audio bytes (e.g. a browser MediaRecorder Blob converted to Buffer). */
  buffer: Buffer;
  /** Used for format sniffing — must carry the real extension (e.g. "clip.webm"). */
  filename: string;
  /** MIME type if known (e.g. "audio/webm"); improves provider-side format detection. */
  mimeType?: string;
}

/**
 * Abstraction over a speech-to-text backend, so the rest of the app never
 * talks to a specific vendor SDK directly. Swap implementations (self-hosted
 * Whisper, Google STT, etc.) without touching callers.
 */
export interface SttProvider {
  transcribe(input: TranscribeInput): Promise<string>;
}
