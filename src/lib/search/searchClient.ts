import type { SearchResult } from "./types";

interface SearchApiResponse {
  results?: SearchResult[];
  error?: string;
}

/** Client-side fetch wrapper for POST /api/search — safe to import into Client Components. */
export async function searchByText(query: string): Promise<SearchResult[]> {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  const data: SearchApiResponse = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? `Search failed (${res.status})`);
  }

  return data.results ?? [];
}
