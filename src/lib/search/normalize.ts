/**
 * Thai text normalization shared between the ingest pipeline (Phase 1) and
 * the query-time matcher (Phase 2). Both sides MUST use the same functions
 * here so that a query's skeleton lines up with the indexed skeleton.
 */

// Thai combining marks: above/below vowel signs + tone marks. These are the
// parts of a word most likely to come out "wrong" from STT (tone/vowel
// spelling drifts even when the consonants are heard correctly), so
// stripping them produces a more forgiving "skeleton" for fuzzy matching.
//   U+0E31        MAI HAN-AKAT
//   U+0E34..0E3A  SARA I, II, UE, UEE, U, UU, PHINTHU
//   U+0E47..0E4E  MAITAIKHU, MAI EK/THO/TRI/CHATTAWA, THANTHAKHAT, NIKHAHIT, YAMAKKAN
const THAI_COMBINING_RANGES: Array<[number, number]> = [
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
];

function isThaiCombiningMark(codePoint: number): boolean {
  return THAI_COMBINING_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi);
}

/**
 * Collapse line breaks / repeated whitespace into single spaces and trim.
 * The CSV source has \r\n inside multi-line lyric fields; raw STT output
 * has no line breaks at all — normalizing both to the same whitespace
 * shape keeps comparisons consistent.
 */
export function cleanText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

/** Join + clean the three lyric fields into one searchable block of text. */
export function buildFullLyrics(
  lead: string | null | undefined,
  hook: string | null | undefined,
  chorus: string | null | undefined
): string {
  return cleanText([cleanText(lead), cleanText(hook), cleanText(chorus)].filter(Boolean).join(" "));
}

/**
 * Strip Thai tone marks + above/below vowel diacritics, producing a
 * "consonant skeleton" that's more tolerant of the tone/vowel drift common
 * in STT transcripts (e.g. sung/spoken tone doesn't always match the
 * written tone mark). Non-Thai characters pass through unchanged.
 */
export function toSkeleton(input: string): string {
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (isThaiCombiningMark(cp)) continue;
    out += ch;
  }
  return cleanText(out);
}
