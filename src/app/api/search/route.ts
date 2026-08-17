import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchLyrics, MIN_SCORE_THRESHOLD } from "@/lib/search/matcher";
import { checkRateLimit } from "@/lib/rateLimit";

// Single search endpoint for both voice (Web Speech API transcript) and
// typed queries — the backend doesn't care where the text came from.
// See docs/PLAN.md Phase 3/4 for why this replaced the originally-planned
// /api/voice-search + /api/text-search split.

const requestSchema = z.object({
  query: z.string().trim().min(1, "query is required").max(500, "query is too long"),
});

function getClientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  const clientKey = getClientKey(request);
  const rateLimit = checkRateLimit(clientKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests, please slow down" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateLimit.retryAfterMs ?? 0) / 1000)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  try {
    const results = await searchLyrics(parsed.data.query, 5);
    // Drop low-confidence noise (see matcher.ts for how the threshold was
    // derived) rather than showing an unrelated "best guess" as if it were
    // a real match.
    const confident = results.filter((r) => r.score >= MIN_SCORE_THRESHOLD);

    return NextResponse.json({ results: confident });
  } catch (err) {
    console.error("POST /api/search failed:", err);
    return NextResponse.json({ error: "Search failed, please try again" }, { status: 500 });
  }
}
