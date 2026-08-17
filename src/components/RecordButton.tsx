"use client";

import { useState, useSyncExternalStore } from "react";
import {
  isSpeechRecognitionSupported,
  listenOnce,
  ListenError,
} from "@/lib/stt/browserSpeechRecognition";
import styles from "./RecordButton.module.css";

// No real "subscription" needed — support never changes after load — but
// useSyncExternalStore is still the correct tool here: it's the one hook
// that knows how to reconcile a value that can only be computed in the
// browser (isSpeechRecognitionSupported() needs `window`) against SSR
// output (getServerSnapshot) without a hydration mismatch or an
// effect-driven setState.
const noopSubscribe = () => () => {};

function useSpeechRecognitionSupport(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => isSpeechRecognitionSupported(),
    () => false
  );
}

type Status = "unsupported" | "idle" | "listening";

function MicIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

interface RecordButtonProps {
  onResult: (transcript: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

function describeError(err: unknown): string {
  if (err instanceof ListenError) {
    switch (err.reason) {
      case "not-allowed":
        return "กรุณาอนุญาตให้เว็บนี้เข้าถึงไมโครโฟน แล้วลองใหม่";
      case "no-speech":
        return "ไม่ได้ยินเสียงพูด ลองพูดอีกครั้ง";
      case "audio-capture":
        return "ไม่พบไมโครโฟนในอุปกรณ์นี้";
      case "network":
        return "เครือข่ายมีปัญหาระหว่างถอดเสียง ลองอีกครั้ง";
      case "aborted":
        return "ฟังนานเกินไป ลองพูดให้เร็วขึ้นหน่อย";
      case "unsupported":
        return "เบราว์เซอร์นี้ไม่รองรับการค้นด้วยเสียง ลองพิมพ์เนื้อเพลงแทน";
      default:
        return "เกิดข้อผิดพลาดระหว่างฟังเสียง ลองอีกครั้ง";
    }
  }
  return "เกิดข้อผิดพลาดระหว่างฟังเสียง ลองอีกครั้ง";
}

/**
 * Mic button wired to the browser's native Web Speech API
 * (src/lib/stt/browserSpeechRecognition.ts). Chrome/Edge only — shows a
 * fallback note on unsupported browsers (Firefox/Safari) so the page
 * still points people at the text input.
 */
export function RecordButton({ onResult, onError, disabled }: RecordButtonProps) {
  const supported = useSpeechRecognitionSupport();
  const [listening, setListening] = useState(false);
  const status: Status = !supported ? "unsupported" : listening ? "listening" : "idle";

  async function handleClick() {
    if (status !== "idle") return;
    setListening(true);
    try {
      const transcript = await listenOnce({ timeoutMs: 10_000 });
      if (!transcript.trim()) {
        onError("ไม่ได้ยินเสียงพูด ลองพูดอีกครั้ง");
      } else {
        onResult(transcript);
      }
    } catch (err) {
      onError(describeError(err));
    } finally {
      setListening(false);
    }
  }

  if (status === "unsupported") {
    return (
      <div className={styles.wrapper}>
        <p className={styles.unsupportedNote}>
          เบราว์เซอร์นี้ไม่รองรับการค้นด้วยเสียง (ใช้ได้ดีบน Chrome หรือ Edge) — พิมพ์เนื้อเพลงในช่องด้านล่างแทนได้เลย
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={`${styles.button} ${listening ? styles.listening : ""}`}
        onClick={handleClick}
        disabled={disabled || listening}
        aria-label={listening ? "กำลังฟัง" : "กดเพื่อพูดเนื้อเพลง"}
      >
        <MicIcon />
      </button>
      <span className={styles.label}>{listening ? "กำลังฟัง... พูดท่อนที่จำได้" : "กดแล้วพูดเนื้อเพลงที่จำได้"}</span>
    </div>
  );
}
