import type { SearchResult } from "@/lib/search/types";
import styles from "./ResultCard.module.css";

interface ResultCardProps {
  result: SearchResult;
}

export function ResultCard({ result }: ResultCardProps) {
  const confidencePercent = Math.round(Math.min(Math.max(result.score, 0), 1) * 100);
  const meta = [result.artist, result.year ? String(result.year) : null].filter(Boolean).join(" · ");

  return (
    <li className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>{result.title}</h3>
        <span className={styles.confidence}>{confidencePercent}%</span>
      </div>
      {meta && <p className={styles.meta}>{meta}</p>}
      <div className={styles.confidenceBar}>
        <div className={styles.confidenceBarFill} style={{ width: `${confidencePercent}%` }} />
      </div>
      <p className={styles.snippet}>{result.snippet}</p>
    </li>
  );
}
