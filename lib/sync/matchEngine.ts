import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import type { MusicServiceAdapter } from "@/lib/services/MusicServiceAdapter";
import { serviceEnum, serviceKey } from "@/lib/services/adapterFactory";
import type { NormalizedTrack, ServiceKey } from "./syncTypes";
import {
  extractVariantTag,
  inferArtistTitleFromDecoratedTitle,
  normalizeArtist,
  normalizeTitle,
  splitArtists,
} from "@/lib/utils/normalizeTrack";
import { calculateSimilarityWithBreakdown } from "@/lib/utils/similarity";
import { parseArtistsJson } from "@/lib/utils/parseArtists";

const LOCAL_FIRST_ACCEPT = Number(process.env.MATCH_LOCAL_FIRST_THRESHOLD ?? 0.88);
const LOCAL_FIRST_ACCEPT_WITH_ISRC = Number(process.env.MATCH_LOCAL_FIRST_THRESHOLD_ISRC ?? 0.82);
const NEGATIVE_CACHE_TTL_MS = Number(process.env.MATCH_NEGATIVE_CACHE_TTL_MINUTES ?? 60 * 24) * 60_000;

const TRGM_THRESHOLD = Number(process.env.MATCH_TRGM_THRESHOLD ?? 0.45);
const TRGM_ENABLED = process.env.MATCH_TRGM_ENABLED !== "false";
const TRGM_STATEMENT_TIMEOUT_MS = Math.max(1, Number(process.env.MATCH_TRGM_STATEMENT_TIMEOUT_MS ?? 1500));

type ServiceTrackRow = {
  title: string;
  artistsJson: string;
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  service: string;
  serviceTrackId: string;
  url: string | null;
};

function rowToTrack(row: ServiceTrackRow): NormalizedTrack {
  return {
    title: row.title,
    artists: parseArtistsJson(row.artistsJson),
    album: row.album || undefined,
    durationMs: row.durationMs || undefined,
    isrc: row.isrc || undefined,
    sourceService: serviceKey(row.service),
    sourceTrackId: row.serviceTrackId,
    url: row.url || undefined,
  };
}

export type LocalCatalogPool = Map<string, NormalizedTrack[]>;

const PREWARM_PER_TITLE_LIMIT = Math.max(1, Number(process.env.MATCH_PREWARM_PER_TITLE_LIMIT ?? 25));

function catalogKey(title: string, artist: string) {
  return `${title}|${artist}`;
}

export async function prewarmLocalCatalog(
  sourceTracks: NormalizedTrack[],
  targetService: ServiceKey,
): Promise<LocalCatalogPool> {
  const titles = new Set<string>();
  const artists = new Set<string>();
  for (const track of sourceTracks) {
    const inferred = inferArtistTitleFromDecoratedTitle(track);
    const t = normalizeTitle(inferred?.title || track.title);
    const a = normalizeArtist(inferred?.artist || splitArtists(track.artists)[0] || "");
    if (t) titles.add(t);
    if (a) artists.add(a);
  }
  if (!titles.size) return new Map();
  const service = serviceEnum(targetService);
  type PrewarmRow = ServiceTrackRow & { titleNormalized: string };
  const rows = await prisma.$queryRaw<PrewarmRow[]>`
    SELECT "title", "artistsJson", "album", "durationMs", "isrc",
           "service", "serviceTrackId", "url", "titleNormalized"
    FROM (
      SELECT st.*,
             ROW_NUMBER() OVER (
               PARTITION BY "titleNormalized"
               ORDER BY ("isrc" IS NOT NULL) DESC, "updatedAt" DESC
             ) AS rn
      FROM "ServiceTrack" st
      WHERE "service" = ${service}
        AND "titleNormalized" IN (${Prisma.join(Array.from(titles))})
        ${artists.size ? Prisma.sql`AND ("artistNormalized" IS NULL OR "artistNormalized" IN (${Prisma.join(Array.from(artists))}))` : Prisma.empty}
    ) ranked
    WHERE rn <= ${PREWARM_PER_TITLE_LIMIT}
  `.catch((error) => {
    console.warn("[matchEngine] prewarmLocalCatalog raw query failed", error);
    return [] as PrewarmRow[];
  });
  const pool: LocalCatalogPool = new Map();
  for (const row of rows) {
    if (!row.titleNormalized) continue;
    const track = rowToTrack(row);
    const artist = normalizeArtist(splitArtists(track.artists)[0] || "");
    const exactKey = catalogKey(row.titleNormalized, artist);
    const exactBucket = pool.get(exactKey) ?? [];
    exactBucket.push(track);
    pool.set(exactKey, exactBucket);
    const titleBucket = pool.get(row.titleNormalized) ?? [];
    titleBucket.push(track);
    pool.set(row.titleNormalized, titleBucket);
  }
  return pool;
}

async function localCatalogLookup(
  sourceTrack: NormalizedTrack,
  targetService: ServiceKey,
  pool?: LocalCatalogPool,
): Promise<NormalizedTrack[]> {
  const inferred = inferArtistTitleFromDecoratedTitle(sourceTrack);
  const title = normalizeTitle(inferred?.title || sourceTrack.title);
  const artist = normalizeArtist(inferred?.artist || splitArtists(sourceTrack.artists)[0] || "");
  if (!title) return [];
  const service = serviceEnum(targetService);

  if (pool) {
    const exact = artist ? pool.get(catalogKey(title, artist)) : undefined;
    if (exact && exact.length) return exact.slice(0, 25);
    const exactTitle = pool.get(title);
    if (exactTitle && exactTitle.length) return exactTitle.slice(0, 25);
  }

  if (TRGM_ENABLED) {
    try {
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${`${TRGM_STATEMENT_TIMEOUT_MS}ms`}, true)`;
        return tx.$queryRaw<ServiceTrackRow[]>`
        SELECT "title", "artistsJson", "album", "durationMs", "isrc",
               "service", "serviceTrackId", "url"
        FROM "ServiceTrack"
        WHERE "service" = ${service}
          AND "titleNormalized" IS NOT NULL
          AND "titleNormalized" % ${title}
          AND similarity("titleNormalized", ${title}) >= ${TRGM_THRESHOLD}
        ORDER BY
          (similarity("titleNormalized", ${title})
           + COALESCE(similarity("artistNormalized", ${artist}), 0) * 0.5) DESC
        LIMIT 25
        `;
      });
      if (rows.length) return rows.map(rowToTrack);
    } catch (error) {
      console.warn("[matchEngine] pg_trgm lookup failed, falling back to exact match", error);
    }
  }

  const rows = await prisma.serviceTrack.findMany({
    where: {
      service,
      titleNormalized: title,
      ...(artist ? { artistNormalized: artist } : {}),
    },
    take: 25,
  });
  return rows.map((row) => rowToTrack(row));
}

export type RankedMatch = {
  track: NormalizedTrack;
  confidence: number;
  breakdown?: ReturnType<typeof calculateSimilarityWithBreakdown>;
};

export type MatchResult = RankedMatch & {
  candidates?: RankedMatch[];
  source?: string;
};

const ACCEPT_CONFIDENCE = Number(process.env.MATCH_ACCEPT_CONFIDENCE ?? 0.65);
const EARLY_EXIT_CONFIDENCE = 0.9;
const AMBIGUITY_GAP = 0.04;
const AMBIGUITY_ZONE_MAX = 0.88;
const AMBIGUITY_CONFIDENCE_CAP = Number(process.env.MATCH_AMBIGUITY_CAP ?? 0.81);
const MAX_QUERY_LENGTH = 120;
const SEARCH_TIMEOUT_MS = Number(process.env.MATCH_SEARCH_TIMEOUT_MS ?? 18_000);
const SEARCH_PARALLELISM = Math.max(1, Number(process.env.MATCH_SEARCH_PARALLELISM ?? 2));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!ms || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("search_timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function variantQueryHint(variant: string): string | null {
  const parts = variant.split("+");
  for (const part of parts) {
    switch (part) {
      case "remix":
        return "remix";
      case "sped_up":
        return "sped up";
      case "slowed":
        return "slowed";
      case "nightcore":
        return "nightcore";
      case "cover":
        return "cover";
      case "mashup":
        return "mashup";
      case "bass_boost":
        return "bass boost";
      case "live":
        return "live";
    }
  }
  return null;
}

function clampQuery(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_QUERY_LENGTH ? trimmed.slice(0, MAX_QUERY_LENGTH) : trimmed;
}

function buildQueries(track: NormalizedTrack): string[] {
  const inferred = inferArtistTitleFromDecoratedTitle(track);
  const title = normalizeTitle(inferred?.title || track.title);
  const artists = splitArtists(inferred?.artist ? [inferred.artist, ...track.artists] : track.artists).map(normalizeArtist).filter(Boolean);
  const primary = artists[0] || "";
  const variant = extractVariantTag(track.title);
  const queries: string[] = [];

  if (primary && title) queries.push(`${primary} ${title}`);
  if (primary && title) queries.push(`${title} ${primary}`);
  if (artists.length > 1) queries.push(`${artists.slice(0, 2).join(" ")} ${title}`);
  if (title) queries.push(title);
  if (variant && title) {
    const variantHint = variantQueryHint(variant);
    if (variantHint) {
      const bracketBody =
        track.title.match(new RegExp(`\\(([^)]*${variantHint}[^)]*)\\)`, "i"))?.[1] ||
        track.title.match(new RegExp(`\\[([^\\]]*${variantHint}[^\\]]*)\\]`, "i"))?.[1] ||
        variantHint;
      queries.push(`${primary} ${title} ${bracketBody}`.trim());
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const cleaned = clampQuery(q);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function trackKey(track: NormalizedTrack) {
  return `${track.sourceService}::${track.sourceTrackId}`;
}

function sourceMetadataHash(track: NormalizedTrack) {
  return createHash("sha256")
    .update(JSON.stringify({
      title: track.title,
      artists: track.artists,
      durationMs: track.durationMs ?? null,
      isrc: track.isrc ?? null,
    }))
    .digest("hex");
}

export async function findMatch(
  sourceTrack: NormalizedTrack,
  targetService: ServiceKey,
  adapter: MusicServiceAdapter,
  options: { skipIsrcDb?: boolean; internalTrackId?: string; localCatalogPool?: LocalCatalogPool; skipExternalSearch?: boolean } = {},
): Promise<MatchResult | null> {
  const metadataHash = sourceMetadataHash(sourceTrack);
  if (options.internalTrackId && NEGATIVE_CACHE_TTL_MS > 0) {
    try {
      const negative = await prisma.trackMatchNegativeCache.findUnique({
        where: {
          internalTrackId_targetService: {
            internalTrackId: options.internalTrackId,
            targetService: serviceEnum(targetService),
          },
        },
      });
      if (
        negative &&
        negative.sourceMetadataHash === metadataHash &&
        Date.now() - negative.attemptedAt.getTime() < NEGATIVE_CACHE_TTL_MS
      ) {
        return null;
      }
    } catch {
      // ignore
    }
  }
  if (sourceTrack.isrc && !options.skipIsrcDb) {
    const dbMatch = await prisma.serviceTrack.findFirst({
      where: { service: serviceEnum(targetService), isrc: sourceTrack.isrc },
    });
    if (dbMatch) {
      return {
        track: {
          title: dbMatch.title,
          artists: parseArtistsJson(dbMatch.artistsJson),
          album: dbMatch.album || undefined,
          durationMs: dbMatch.durationMs || undefined,
          isrc: dbMatch.isrc || undefined,
          sourceService: targetService,
          sourceTrackId: dbMatch.serviceTrackId,
          url: dbMatch.url || undefined,
        },
        confidence: 1,
        candidates: [],
        source: "isrc_db",
      };
    }
  }

  const localCandidates = await localCatalogLookup(sourceTrack, targetService, options.localCatalogPool).catch(
    () => [] as NormalizedTrack[],
  );
  if (localCandidates.length) {
    const ranked = rankCandidates(sourceTrack, localCandidates);
    const top = ranked[0];
    const localThreshold = sourceTrack.isrc ? LOCAL_FIRST_ACCEPT_WITH_ISRC : LOCAL_FIRST_ACCEPT;
    if (isAmbiguous(ranked)) {
      const cappedConfidence = Math.min(top.confidence, AMBIGUITY_CONFIDENCE_CAP);
      return { track: top.track, confidence: cappedConfidence, candidates: ranked.slice(0, 10), source: "local_catalog_ambiguous" };
    }
    if (top && top.confidence >= localThreshold) {
      return { ...top, candidates: ranked.slice(0, 10), source: "local_catalog" };
    }
  }
  if (options.skipExternalSearch) return null;

  const queries = buildQueries(sourceTrack);
  const inferred = inferArtistTitleFromDecoratedTitle(sourceTrack);
  const structuredTitle = normalizeTitle(inferred?.title || sourceTrack.title);
  const structuredArtist = normalizeArtist(inferred?.artist || splitArtists(sourceTrack.artists)[0] || "");
  const pool = new Map<string, NormalizedTrack>();
  let searchHadFailure = false;
  for (const candidate of localCandidates) {
    pool.set(trackKey(candidate), candidate);
  }
  let best: RankedMatch | null = null;

  for (let batchStart = 0; batchStart < queries.length; batchStart += SEARCH_PARALLELISM) {
    const batch = queries.slice(batchStart, batchStart + SEARCH_PARALLELISM);
    const results = await Promise.all(
      batch.map((query, offset) => {
        const i = batchStart + offset;
        return withTimeout(
          adapter.searchTrack({
            query,
            isrc: sourceTrack.isrc,
            title: i === 0 ? structuredTitle : undefined,
            artist: i === 0 ? structuredArtist : undefined,
          }),
          SEARCH_TIMEOUT_MS,
        ).catch(() => {
          searchHadFailure = true;
          return [] as NormalizedTrack[];
        });
      }),
    );
    for (const candidates of results) {
      for (const candidate of candidates) {
        const key = trackKey(candidate);
        if (!pool.has(key)) pool.set(key, candidate);
      }
    }
    const ranked = rankCandidates(sourceTrack, Array.from(pool.values()));
    const top = ranked[0];
    if (top && (!best || top.confidence > best.confidence)) best = top;
    if (best && best.confidence >= EARLY_EXIT_CONFIDENCE) break;
  }

  const ranked = rankCandidates(sourceTrack, Array.from(pool.values()));
  const top = ranked[0] || null;
  if (!top || top.confidence < ACCEPT_CONFIDENCE) {
    if (options.internalTrackId && NEGATIVE_CACHE_TTL_MS > 0 && !searchHadFailure) {
      prisma.trackMatchNegativeCache
        .upsert({
          where: {
            internalTrackId_targetService: {
              internalTrackId: options.internalTrackId,
              targetService: serviceEnum(targetService),
            },
          },
          update: { attemptedAt: new Date(), sourceMetadataHash: metadataHash },
          create: {
            internalTrackId: options.internalTrackId,
            targetService: serviceEnum(targetService),
            sourceMetadataHash: metadataHash,
          },
        })
        .catch(() => {});
    }
    return null;
  }
  if (isAmbiguous(ranked)) {
    const cappedConfidence = Math.min(top.confidence, AMBIGUITY_CONFIDENCE_CAP);
    return {
      track: top.track,
      confidence: cappedConfidence,
      candidates: ranked.slice(0, 10),
      source: "search_ambiguous",
    };
  }
  return { ...top, candidates: ranked.slice(0, 10), source: "search" };
}

function isAmbiguous(ranked: RankedMatch[]) {
  const top = ranked[0];
  const second = ranked[1];
  if (!top || !second) return false;
  const closeGap = top.confidence - second.confidence < AMBIGUITY_GAP;
  if (!closeGap) return false;
  if (top.confidence <= AMBIGUITY_ZONE_MAX) return true;
  const bothStrong = second.confidence >= ACCEPT_CONFIDENCE;
  const exactIsrc = Boolean(top.track.isrc && second.track.isrc && top.track.isrc === second.track.isrc);
  return bothStrong && !exactIsrc;
}

function dedupeCandidates(candidates: NormalizedTrack[]) {
  const byKey = new Map<string, NormalizedTrack>();
  for (const candidate of candidates) {
    const isrcKey = candidate.isrc ? `isrc:${candidate.isrc}` : "";
    const title = normalizeTitle(candidate.title);
    const artist = normalizeArtist(splitArtists(candidate.artists)[0] || "");
    const bucket = candidate.durationMs ? Math.round(candidate.durationMs / 5_000) : "?";
    const variant = extractVariantTag(candidate.title) || "";
    const keys = isrcKey
      ? [isrcKey]
      : bucket === "?"
        ? [`${title}|${artist}|?|${variant}`]
        : [
            `${title}|${artist}|${bucket}|${variant}`,
            `${title}|${artist}|${Number(bucket) - 1}|${variant}`,
            `${title}|${artist}|${Number(bucket) + 1}|${variant}`,
          ];
    if (keys.some((key) => byKey.has(key))) continue;
    for (const key of keys) byKey.set(key, candidate);
  }
  return Array.from(new Set(byKey.values()));
}

export function rankCandidates(sourceTrack: NormalizedTrack, candidates: NormalizedTrack[]) {
  return dedupeCandidates(candidates)
    .map((track) => {
      const breakdown = calculateSimilarityWithBreakdown(sourceTrack, track);
      return { track, confidence: breakdown.score, breakdown };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

export { normalizeArtist, normalizeTitle };
