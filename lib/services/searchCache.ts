import type { NormalizedTrack, ServiceKey } from "@/lib/sync/syncTypes";

const DEFAULT_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MINUTES || 60) * 60_000;
const MAX_ENTRIES = Number(process.env.SEARCH_CACHE_MAX_ENTRIES || 500);

type CacheEntry = {
  expiresAt: number;
  tracks: NormalizedTrack[];
};

const cache = new Map<string, CacheEntry>();

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheKey(service: ServiceKey, query: string): string {
  return `${service}:${normalizeQuery(query)}`;
}

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key);
  }

  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export async function cachedSearchTracks(
  service: ServiceKey,
  query: string,
  search: () => Promise<NormalizedTrack[]>,
): Promise<NormalizedTrack[]> {
  pruneCache();
  const key = cacheKey(service, query);
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    return existing.tracks;
  }

  const tracks = await search();
  cache.set(key, { tracks, expiresAt: Date.now() + DEFAULT_TTL_MS });
  pruneCache();
  return tracks;
}

export function invalidateSearchCache(service?: ServiceKey) {
  if (!service) {
    cache.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.startsWith(`${service}:`)) cache.delete(key);
  }
}
