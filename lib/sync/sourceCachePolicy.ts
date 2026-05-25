const DEFAULT_SOURCE_CACHE_MAX_AGE_SECONDS = 120;

export function sourceCacheMaxAgeMs(envValue: unknown = process.env.WORKER_SOURCE_CACHE_MAX_AGE_SECONDS): number {
  const seconds = Number(envValue ?? DEFAULT_SOURCE_CACHE_MAX_AGE_SECONDS);
  return Math.max(0, Number.isFinite(seconds) ? seconds : DEFAULT_SOURCE_CACHE_MAX_AGE_SECONDS) * 1000;
}

export function shouldRefreshSourceCache({
  lastFetchedAt,
  forceRefresh,
  maxAgeMs = sourceCacheMaxAgeMs(),
  now = new Date(),
}: {
  lastFetchedAt: Date | null | undefined;
  forceRefresh?: boolean;
  maxAgeMs?: number;
  now?: Date;
}): boolean {
  if (forceRefresh) return true;
  if (!lastFetchedAt) return true;
  if (maxAgeMs <= 0) return false;
  return now.getTime() - lastFetchedAt.getTime() > maxAgeMs;
}
