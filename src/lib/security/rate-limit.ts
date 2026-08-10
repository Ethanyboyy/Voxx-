/**
 * In-memory fixed-window rate limiter. Deliberately not distributed/shared
 * storage: VOX runs as a single always-on instance (no horizontal scaling —
 * see PHASE_2_ARCHITECTURE.md / SECURITY.md), so a process-local Map is
 * sufficient and avoids adding Redis or another service purely for this.
 * Resets on process restart, which is an acceptable tradeoff at this scale.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Returns true if the call is allowed under `limit` requests per `windowMs`, keyed by `key`. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
