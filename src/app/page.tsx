"use client";

import { useState, type FormEvent } from "react";
import { RecordButton } from "@/components/RecordButton";
import { ResultCard } from "@/components/ResultCard";
import { searchByText } from "@/lib/search/searchClient";
import type { SearchResult } from "@/lib/search/types";
import styles from "./page.module.css";

type Phase = "idle" | "searching" | "done" | "error";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [query, setQuery] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  async function runSearch(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    setQuery(trimmed);
    setPhase("searching");
    setErrorMessage("");

    try {
      const found = await searchByText(trimmed);
      setResults(found);
      setPhase("done");
    } catch (err) {
      setResults([]);
      setErrorMessage(err instanceof Error ? err.message : "เกิดข้อผิดพลาด ลองอีกครั้ง");
      setPhase("error");
    }
  }

  function handleVoiceResult(transcript: string) {
    setInputValue(transcript);
    void runSearch(transcript);
  }

  function handleVoiceError(message: string) {
    setErrorMessage(message);
    setPhase("error");
  }

  function handleTextSubmit(e: FormEvent) {
    e.preventDefault();
    void runSearch(inputValue);
  }

  const isSearching = phase === "searching";

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.appTitle}>🎵 SongLens</h1>
          <p className={styles.tagline}>จำเนื้อเพลงได้บางท่อน? พูดหรือพิมพ์ แล้วให้เราช่วยหาเพลงลูกทุ่งที่ใช่</p>
        </header>

        <RecordButton onResult={handleVoiceResult} onError={handleVoiceError} disabled={isSearching} />

        <div className={styles.divider}>หรือ</div>

        <form className={styles.textForm} onSubmit={handleTextSubmit}>
          <input
            className={styles.textInput}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="พิมพ์เนื้อเพลงท่อนที่จำได้..."
            disabled={isSearching}
          />
          <button className={styles.searchButton} type="submit" disabled={isSearching || !inputValue.trim()}>
            ค้นหา
          </button>
        </form>

        <section className={styles.results} aria-live="polite">
          {isSearching && <p className={styles.status}>กำลังค้นหา...</p>}

          {!isSearching && query && (
            <p className={styles.queryEcho}>
              ค้นจาก: <span>&ldquo;{query}&rdquo;</span>
            </p>
          )}

          {phase === "error" && errorMessage && <p className={styles.errorText}>{errorMessage}</p>}

          {phase === "done" && results.length === 0 && (
            <p className={styles.status}>ไม่พบเพลงที่ตรงกัน ลองพูด/พิมพ์ท่อนอื่น หรือพูดให้ชัดขึ้น</p>
          )}

          {phase === "done" && results.length > 0 && (
            <ul className={styles.resultList}>
              {results.map((r) => (
                <ResultCard key={r.id} result={r} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
