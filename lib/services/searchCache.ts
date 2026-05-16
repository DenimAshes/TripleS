import type { NormalizedTrack, ServiceKey } from "@/lib/sync/syncTypes";
import { prisma } from "@/lib/db/prisma";

const DEFAULT_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MINUTES || 60) * 60_000;
const PERSISTENT_TTL_MS = Number(process.env.SEARCH_CACHE_PERSIST_TTL_MINUTES || 60 * 24 * 7) * 60_000;
const MAX_ENTRIES = Number(process.env.SEARCH_CACHE_MAX_ENTRIES || 500);
const DB_MAX_ENTRIES = Number(process.env.SEARCH_CACHE_DB_MAX_ENTRIES || 50_000);
const PERSIST_ENABLED = process.env.SEARCH_CACHE_PERSIST !== "false";
const PRUNE_EVERY_N_LOOKUPS = Number(process.env.SEARCH_CACHE_PRUNE_EVERY || 200);

type CacheEntry = {
  expiresAt: number;
  tracks: NormalizedTrack[];
};

const cache = new Map<string, CacheEntry>();

function normalizeQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return "";
  tokens.sort();
  return tokens.join(" ");
}

function normalizeIsrc(isrc?: string): string {
  return (isrc || "").trim().toUpperCase();
}

function cacheKey(service: ServiceKey, queryNorm: string, isrc?: string): string {
  return `${service}:${queryNorm}:${normalizeIsrc(isrc)}`;
}

function persistedQueryNorm(queryNorm: string, isrc?: string): string {
  const isrcNorm = normalizeIsrc(isrc);
  return isrcNorm ? `${queryNorm}:isrc=${isrcNorm}` : `${queryNorm}:isrc=`;
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

let dbPruneInFlight: Promise<void> | null = null;
let lookupsSinceLastPrune = 0;

// Delete SearchCache rows older than PERSISTENT_TTL_MS, then trim by size
// (oldest fetchedAt first) if we still exceed DB_MAX_ENTRIES. Returns the
// number of rows removed. Safe to call from anywhere; concurrent calls are
// coalesced via dbPruneInFlight so multiple sync runs don't stampede.
export async function pruneSearchCacheDb(): Promise<number> {
  if (!PERSIST_ENABLED) return 0;
  if (dbPruneInFlight) {
    await dbPruneInFlight;
    return 0;
  }
  const run = async () => {
    let removed = 0;
    const expiredCutoff = new Date(Date.now() - PERSISTENT_TTL_MS);
    const expired = await prisma.searchCache
      .deleteMany({ where: { fetchedAt: { lt: expiredCutoff } } })
      .catch(() => ({ count: 0 }));
    removed += expired.count;
    const total = await prisma.searchCache.count().catch(() => 0);
    if (total > DB_MAX_ENTRIES) {
      const excess = total - DB_MAX_ENTRIES;
      const oldRows = await prisma.searchCache
        .findMany({ orderBy: { fetchedAt: "asc" }, take: excess, select: { id: true } })
        .catch(() => [] as Array<{ id: string }>);
      if (oldRows.length) {
        const trim = await prisma.searchCache
          .deleteMany({ where: { id: { in: oldRows.map((row) => row.id) } } })
          .catch(() => ({ count: 0 }));
        removed += trim.count;
      }
    }
    return removed;
  };
  let removedOut = 0;
  dbPruneInFlight = (async () => {
    removedOut = await run();
  })();
  try {
    await dbPruneInFlight;
    return removedOut;
  } finally {
    dbPruneInFlight = null;
  }
}

function maybePruneDbAsync() {
  if (!PERSIST_ENABLED) return;
  lookupsSinceLastPrune += 1;
  if (lookupsSinceLastPrune < PRUNE_EVERY_N_LOOKUPS) return;
  lookupsSinceLastPrune = 0;
  pruneSearchCacheDb().catch(() => undefined);
}

export async function cachedSearchTracks(
  service: ServiceKey,
  query: string,
  search: () => Promise<NormalizedTrack[]>,
  isrc?: string,
): Promise<NormalizedTrack[]> {
  pruneCache();
  maybePruneDbAsync();
  const queryNorm = normalizeQuery(query);
  const dbQueryNorm = persistedQueryNorm(queryNorm, isrc);
  const key = cacheKey(service, queryNorm, isrc);
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    return existing.tracks;
  }

  if (PERSIST_ENABLED) {
    try {
      const persisted = await prisma.searchCache.findUnique({
        where: { service_queryNorm: { service, queryNorm: dbQueryNorm } },
      });
      if (persisted && Date.now() - persisted.fetchedAt.getTime() < PERSISTENT_TTL_MS) {
        const tracks = JSON.parse(persisted.resultsJson) as NormalizedTrack[];
        cache.set(key, { tracks, expiresAt: Date.now() + DEFAULT_TTL_MS });
        return tracks;
      }
    } catch {
      // ignore cache read failures
    }
  }

  const tracks = await search();
  cache.set(key, { tracks, expiresAt: Date.now() + DEFAULT_TTL_MS });
  pruneCache();

  if (PERSIST_ENABLED && tracks.length) {
    prisma.searchCache
      .upsert({
        where: { service_queryNorm: { service, queryNorm: dbQueryNorm } },
        update: { resultsJson: JSON.stringify(tracks), fetchedAt: new Date() },
        create: { service, queryNorm: dbQueryNorm, resultsJson: JSON.stringify(tracks) },
      })
      .catch(() => {});
  }
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
