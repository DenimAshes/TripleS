// In-memory sliding-window rate limiter, keyed by (userId, bucket). Good
// enough for protecting endpoints that kick off expensive work (sync runs,
// browser-job submissions) on a single-process Next.js server. For a
// multi-instance deploy this should move to Redis, but this layer alone
// already prevents the most common foot-gun: a user smashing "Run now"
// twenty times in a row and queueing duplicate work.

const buckets = new Map<string, number[]>();

export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
};

export function rateLimit(
  key: string,
  options: { windowMs: number; max: number },
): RateLimitResult {
  const now = Date.now();
  const cutoff = now - options.windowMs;
  const history = (buckets.get(key) ?? []).filter((ts) => ts > cutoff);
  if (history.length >= options.max) {
    const oldest = history[0];
    return {
      allowed: false,
      retryAfterMs: Math.max(1, oldest + options.windowMs - now),
      remaining: 0,
    };
  }
  history.push(now);
  buckets.set(key, history);
  return { allowed: true, retryAfterMs: 0, remaining: options.max - history.length };
}

// Periodic janitor so the map doesn't keep keys for users who left long ago.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60_000;
  for (const [key, history] of buckets.entries()) {
    const fresh = history.filter((ts) => ts > cutoff);
    if (!fresh.length) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}, 5 * 60_000).unref?.();
