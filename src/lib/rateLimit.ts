/**
 * In-memory per-key rate limiting. Good enough for a single Node.js
 * server instance (dev, or a Vercel deployment before it needs to scale
 * past one warm instance) — resets on cold start and doesn't coordinate
 * across instances. Swap for a shared store (Upstash Redis, etc.) if the
 * app ever needs multi-instance limits (Phase 8 hardening candidate).
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Cheap opportunistic cleanup so `buckets` doesn't grow forever across a
// long-running process — no need for a dedicated timer for this scale.
function sweepExpired(now: number) {
  if (Math.random() > 0.01) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  sweepExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (bucket.count >= MAX_REQUESTS) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count++;
  return { allowed: true };
}
