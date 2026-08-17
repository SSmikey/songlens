/**
 * Pure types shared between the server-side matcher (matcher.ts, which
 * pulls in the `pg` Node driver) and client components. Client code must
 * only ever `import type` from here — never import matcher.ts directly,
 * or `pg` ends up in the browser bundle.
 */
export interface SearchResult {
  id: number;
  title: string;
  artist: string;
  year: number | null;
  emotion: string | null;
  score: number;
  snippet: string;
}
