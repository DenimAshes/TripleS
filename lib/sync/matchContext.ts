import { Prisma, type ServiceTrack } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { serviceEnum, serviceKey } from "@/lib/services/adapterFactory";
import type { NormalizedTrack, ServiceKey } from "./syncTypes";
import { extractVariantTag, normalizeArtist, normalizeTitle, splitArtists } from "@/lib/utils/normalizeTrack";
import { parseArtistsJson } from "@/lib/utils/parseArtists";

const STORED_MATCH_WINDOW_DAYS = Math.max(0, Number(process.env.MATCH_STORED_MATCH_WINDOW_DAYS ?? 365));
const FINGERPRINT_MERGE_ENABLED = process.env.MATCH_FINGERPRINT_MERGE_ENABLED !== "false";

export type MatchContext = {
  targetService: string;
  storedMatchByInternalId: Map<string, { serviceTrack: ServiceTrack; confidence: number; status: string }>;
  isrcMatchByIsrc: Map<string, ServiceTrack>;
  existingByIsrc: Map<string, NormalizedTrack>;
  existingByFingerprint: Map<string, NormalizedTrack>;
};

export function fingerprintParts(track: NormalizedTrack) {
  const titleNormalized = normalizeTitle(track.title);
  const artistNormalized = normalizeArtist(splitArtists(track.artists)[0] || "");
  const durationBucket = track.durationMs ? Math.round(track.durationMs / 5_000) : null;
  return { titleNormalized, artistNormalized, durationBucket };
}

function strictFingerprintParts(track: NormalizedTrack) {
  const base = fingerprintParts(track);
  const variantTag = extractVariantTag(track.title) || "";
  if (!base.titleNormalized || !base.artistNormalized || base.durationBucket == null) return null;
  if (base.titleNormalized.length < 3 || base.artistNormalized.length < 2) return null;
  return { ...base, variantTag };
}

function strictFingerprintKey(track: NormalizedTrack) {
  const fp = strictFingerprintParts(track);
  if (!fp) return null;
  return `${fp.titleNormalized}|${fp.artistNormalized}|${fp.durationBucket}|${fp.variantTag}`;
}

function deterministicFingerprintInternalId(key: string) {
  return `fp_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function fingerprint(track: NormalizedTrack) {
  const { titleNormalized, artistNormalized, durationBucket } = fingerprintParts(track);
  return `${titleNormalized}|${artistNormalized}|${durationBucket ?? "?"}`;
}

function fingerprintCandidateKeys(track: NormalizedTrack): string[] {
  const { titleNormalized, artistNormalized, durationBucket } = fingerprintParts(track);
  if (durationBucket == null) {
    return [`${titleNormalized}|${artistNormalized}|?`];
  }
  return [
    `${titleNormalized}|${artistNormalized}|${durationBucket}`,
    `${titleNormalized}|${artistNormalized}|${durationBucket - 1}`,
    `${titleNormalized}|${artistNormalized}|${durationBucket + 1}`,
    `${titleNormalized}|${artistNormalized}|?`,
  ];
}

function targetField(service: string) {
  if (service === "SPOTIFY") return "spotifyServiceTrackId" as const;
  if (service === "YOUTUBE") return "youtubeServiceTrackId" as const;
  return "soundcloudServiceTrackId" as const;
}

export async function buildMatchContext({
  internalTrackIds,
  sourceTracks,
  targetService,
  destinationTracks,
  sourceService,
  userId,
}: {
  internalTrackIds: string[];
  sourceTracks: NormalizedTrack[];
  targetService: string;
  destinationTracks: NormalizedTrack[];
  sourceService: string;
  userId: string;
}): Promise<MatchContext> {
  const destinationField = targetField(targetService);
  const destinationColumn = Prisma.raw(`"${destinationField}"`);
  const sourceColumn = Prisma.raw(`"${targetField(sourceService)}"`);
  const storedMatchSince = STORED_MATCH_WINDOW_DAYS
    ? new Date(Date.now() - STORED_MATCH_WINDOW_DAYS * 24 * 60 * 60_000)
    : null;

  type StoredJoinRow = ServiceTrack & {
    matchInternalTrackId: string;
    matchConfidence: number;
    matchStatus: string;
  };

  const [storedJoinRows, isrcMatches] = await Promise.all([
    internalTrackIds.length
      ? prisma.$queryRaw<StoredJoinRow[]>`
          SELECT st.*,
                 tm."internalTrackId" AS "matchInternalTrackId",
                 tm."confidence" AS "matchConfidence",
                 tm."status" AS "matchStatus"
          FROM "TrackMatch" tm
          INNER JOIN "ServiceTrack" st ON st."id" = tm.${destinationColumn}
          LEFT JOIN "ManualMatchCandidate" mmc
            ON mmc."userId" = ${userId}
           AND mmc."sourceServiceTrackId" = tm.${sourceColumn}
           AND mmc."targetService" = ${targetService}
           AND mmc."candidateServiceTrackId" = tm.${destinationColumn}
           AND mmc."status" = 'REJECTED'
          WHERE tm."internalTrackId" IN (${Prisma.join(internalTrackIds)})
            AND tm.${destinationColumn} IS NOT NULL
            AND tm."status" IN ('CONFIRMED', 'AUTO_MATCHED')
            ${storedMatchSince ? Prisma.sql`AND tm."updatedAt" >= ${storedMatchSince}` : Prisma.empty}
            AND mmc."id" IS NULL
          ORDER BY tm."status" DESC, tm."confidence" DESC
        `
      : Promise.resolve([] as StoredJoinRow[]),
    (() => {
      const isrcs = Array.from(
        new Set(sourceTracks.map((track) => track.isrc).filter((value): value is string => Boolean(value))),
      );
      if (!isrcs.length) return Promise.resolve([] as ServiceTrack[]);
      return prisma.serviceTrack.findMany({
        where: { service: serviceEnum(targetService as ServiceKey), isrc: { in: isrcs } },
      });
    })(),
  ]);

  const storedMatchByInternalId = new Map<
    string,
    { serviceTrack: ServiceTrack; confidence: number; status: string }
  >();
  for (const row of storedJoinRows) {
    if (storedMatchByInternalId.has(row.matchInternalTrackId)) continue;
    const { matchInternalTrackId, matchConfidence, matchStatus, ...serviceTrack } = row;
    storedMatchByInternalId.set(matchInternalTrackId, {
      serviceTrack: serviceTrack as ServiceTrack,
      confidence: matchConfidence,
      status: matchStatus,
    });
  }

  const isrcMatchByIsrc = new Map<string, ServiceTrack>();
  for (const track of isrcMatches) {
    if (track.isrc && !isrcMatchByIsrc.has(track.isrc)) isrcMatchByIsrc.set(track.isrc, track);
  }

  const existingByIsrc = new Map<string, NormalizedTrack>();
  const existingByFingerprint = new Map<string, NormalizedTrack>();
  for (const track of destinationTracks) {
    if (track.isrc && !existingByIsrc.has(track.isrc)) existingByIsrc.set(track.isrc, track);
    const fp = fingerprint(track);
    if (!existingByFingerprint.has(fp)) existingByFingerprint.set(fp, track);
  }

  return {
    targetService,
    storedMatchByInternalId,
    isrcMatchByIsrc,
    existingByIsrc,
    existingByFingerprint,
  };
}

export function lookupExistingInPlaylist(ctx: MatchContext, source: NormalizedTrack): NormalizedTrack | undefined {
  if (source.isrc) {
    const byIsrc = ctx.existingByIsrc.get(source.isrc);
    if (byIsrc) return byIsrc;
  }
  for (const key of fingerprintCandidateKeys(source)) {
    const hit = ctx.existingByFingerprint.get(key);
    if (hit) return hit;
  }
  return undefined;
}

export function lookupIsrcMatch(ctx: MatchContext, source: NormalizedTrack): NormalizedTrack | undefined {
  if (!source.isrc) return undefined;
  const track = ctx.isrcMatchByIsrc.get(source.isrc);
  if (!track) return undefined;
  return {
    title: track.title,
    artists: parseArtistsJson(track.artistsJson),
    album: track.album || undefined,
    durationMs: track.durationMs || undefined,
    isrc: track.isrc || undefined,
    sourceService: serviceKey(track.service),
    sourceTrackId: track.serviceTrackId,
    url: track.url || undefined,
  };
}

export async function resolveInternalTrackId(track: NormalizedTrack): Promise<string> {
  if (track.isrc) {
    const existing = await prisma.internalTrack.findFirst({ where: { isrc: track.isrc }, select: { id: true } });
    if (existing) return existing.id;
    return `isrc_${track.isrc}`;
  }
  if (FINGERPRINT_MERGE_ENABLED) {
    const fp = strictFingerprintParts(track);
    const key = strictFingerprintKey(track);
    if (fp && key) {
      const rows = await prisma.serviceTrack.findMany({
        where: {
          isrc: null,
          titleNormalized: fp.titleNormalized,
          artistNormalized: fp.artistNormalized,
          durationBucket: fp.durationBucket,
        },
        select: {
          internalTrackId: true,
          title: true,
          titleNormalized: true,
          artistNormalized: true,
          durationBucket: true,
        },
      });
      const matchingInternalIds = new Set<string>();
      for (const row of rows) {
        const variantTag = extractVariantTag(row.title) || "";
        const rowKey = `${row.titleNormalized}|${row.artistNormalized}|${row.durationBucket}|${variantTag}`;
        if (rowKey === key) matchingInternalIds.add(row.internalTrackId);
      }
      if (matchingInternalIds.size === 1) return Array.from(matchingInternalIds)[0];
      return deterministicFingerprintInternalId(key);
    }
  }
  return `${track.sourceService}_${track.sourceTrackId}`;
}

async function resolveInternalIdsForBatch(tracks: NormalizedTrack[]): Promise<Map<NormalizedTrack, string>> {
  // First, see if any of these tracks already exist as ServiceTrack. If so,
  // their existing internalTrackId is authoritative — using a different one
  // (e.g. a fresh fingerprint-derived id) would leave the existing row
  // orphaned because (service, serviceTrackId) is unique and createMany(skipDuplicates)
  // silently keeps the old row.
  const existing = await prisma.serviceTrack.findMany({
    where: {
      OR: tracks.map((track) => ({
        service: serviceEnum(track.sourceService),
        serviceTrackId: track.sourceTrackId,
      })),
    },
    select: { service: true, serviceTrackId: true, internalTrackId: true },
  });
  const existingByKey = new Map<string, string>();
  for (const row of existing) {
    existingByKey.set(`${row.service}::${row.serviceTrackId}`, row.internalTrackId);
  }

  const isrcs = Array.from(
    new Set(tracks.map((track) => track.isrc).filter((value): value is string => Boolean(value))),
  );
  const isrcToInternalId = new Map<string, string>();
  if (isrcs.length) {
    const rows = await prisma.internalTrack.findMany({
      where: { isrc: { in: isrcs } },
      select: { id: true, isrc: true },
    });
    for (const row of rows) {
      if (row.isrc && !isrcToInternalId.has(row.isrc)) isrcToInternalId.set(row.isrc, row.id);
    }
  }
  const fingerprintTracks = FINGERPRINT_MERGE_ENABLED
    ? tracks.filter((track) => !track.isrc && strictFingerprintKey(track))
    : [];
  const fingerprintToInternalId = new Map<string, string>();
  if (fingerprintTracks.length) {
    const titleValues = Array.from(new Set(fingerprintTracks.map((track) => strictFingerprintParts(track)!.titleNormalized)));
    const artistValues = Array.from(new Set(fingerprintTracks.map((track) => strictFingerprintParts(track)!.artistNormalized)));
    const bucketValues = Array.from(
      new Set(fingerprintTracks.map((track) => strictFingerprintParts(track)!.durationBucket).filter((value): value is number => value != null)),
    );
    const rows = await prisma.serviceTrack.findMany({
      where: {
        isrc: null,
        titleNormalized: { in: titleValues },
        artistNormalized: { in: artistValues },
        durationBucket: { in: bucketValues },
      },
      select: {
        internalTrackId: true,
        title: true,
        titleNormalized: true,
        artistNormalized: true,
        durationBucket: true,
      },
    });
    const candidatesByFingerprint = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.titleNormalized || !row.artistNormalized || row.durationBucket == null) continue;
      const variantTag = extractVariantTag(row.title) || "";
      const key = `${row.titleNormalized}|${row.artistNormalized}|${row.durationBucket}|${variantTag}`;
      const ids = candidatesByFingerprint.get(key) ?? new Set<string>();
      ids.add(row.internalTrackId);
      candidatesByFingerprint.set(key, ids);
    }
    for (const [key, ids] of candidatesByFingerprint) {
      if (ids.size === 1) fingerprintToInternalId.set(key, Array.from(ids)[0]);
    }
  }
  const result = new Map<NormalizedTrack, string>();
  for (const track of tracks) {
    const existingId = existingByKey.get(`${serviceEnum(track.sourceService)}::${track.sourceTrackId}`);
    if (existingId) {
      result.set(track, existingId);
      continue;
    }
    if (track.isrc && isrcToInternalId.has(track.isrc)) {
      result.set(track, isrcToInternalId.get(track.isrc)!);
    } else if (track.isrc) {
      // No existing InternalTrack for this ISRC — use a deterministic isrc-keyed id
      // so concurrent inserts collide on PK and createMany(skipDuplicates) handles them.
      result.set(track, `isrc_${track.isrc}`);
    } else if (FINGERPRINT_MERGE_ENABLED) {
      const key = strictFingerprintKey(track);
      if (key) {
        result.set(track, fingerprintToInternalId.get(key) ?? deterministicFingerprintInternalId(key));
      } else {
        result.set(track, `${track.sourceService}_${track.sourceTrackId}`);
      }
    } else {
      result.set(track, `${track.sourceService}_${track.sourceTrackId}`);
    }
  }
  return result;
}

export async function bulkUpsertServiceTracks(tracks: NormalizedTrack[]): Promise<Map<string, ServiceTrack>> {
  if (!tracks.length) return new Map();

  const byKey = new Map<string, NormalizedTrack>();
  for (const track of tracks) {
    byKey.set(`${track.sourceService}::${track.sourceTrackId}`, track);
  }
  const uniqueTracks = Array.from(byKey.values());

  const internalIdByTrack = await resolveInternalIdsForBatch(uniqueTracks);
  const uniqueInternal = new Map<string, NormalizedTrack>();
  for (const track of uniqueTracks) {
    const id = internalIdByTrack.get(track)!;
    if (!uniqueInternal.has(id)) uniqueInternal.set(id, track);
  }
  await prisma.internalTrack.createMany({
    data: Array.from(uniqueInternal.entries()).map(([id, track]) => ({
      id,
      canonicalTitle: track.title,
      canonicalArtists: JSON.stringify(track.artists),
      canonicalAlbum: track.album,
      durationMs: track.durationMs,
      isrc: track.isrc,
    })),
    skipDuplicates: true,
  });
  const internalIds = Array.from(uniqueInternal.keys());

  const serviceGroups = new Map<string, NormalizedTrack[]>();
  for (const track of uniqueTracks) {
    const list = serviceGroups.get(track.sourceService) ?? [];
    list.push(track);
    serviceGroups.set(track.sourceService, list);
  }

  for (const [service, group] of serviceGroups) {
    const serviceDb = serviceEnum(service as ServiceKey);
    await prisma.serviceTrack.createMany({
      data: group.map((track) => {
        const fp = fingerprintParts(track);
        return {
          internalTrackId: internalIdByTrack.get(track)!,
          service: serviceDb,
          serviceTrackId: track.sourceTrackId,
          title: track.title,
          artistsJson: JSON.stringify(track.artists),
          album: track.album,
          durationMs: track.durationMs,
          isrc: track.isrc,
          url: track.url,
          imageUrl: track.imageUrl,
          titleNormalized: fp.titleNormalized || null,
          artistNormalized: fp.artistNormalized || null,
          durationBucket: fp.durationBucket,
        };
      }),
      skipDuplicates: true,
    });

    const isrcs = Array.from(
      new Set(group.map((track) => track.isrc).filter((value): value is string => Boolean(value))),
    );
    if (isrcs.length) {
      await prisma
        .$executeRaw`
          DELETE FROM "TrackMatchNegativeCache"
          WHERE "targetService" = ${serviceDb}
            AND "internalTrackId" IN (
              SELECT "id" FROM "InternalTrack" WHERE "isrc" IN (${Prisma.join(isrcs)})
            )
        `
        .catch(() => undefined);
    }
  }

  const rows = await prisma.serviceTrack.findMany({
    where: { internalTrackId: { in: internalIds } },
  });
  const trackByDbKey = new Map<string, NormalizedTrack>();
  for (const track of uniqueTracks) {
    trackByDbKey.set(`${serviceEnum(track.sourceService)}::${track.sourceTrackId}`, track);
  }
  const result = new Map<string, ServiceTrack>();
  const staleUpdates: Promise<unknown>[] = [];
  for (const row of rows) {
    const matchingTrack = trackByDbKey.get(`${row.service}::${row.serviceTrackId}`);
    if (!matchingTrack) continue;
    result.set(`${matchingTrack.sourceService}::${matchingTrack.sourceTrackId}`, row);

    const updates: Record<string, unknown> = {};
    if (!row.isrc && matchingTrack.isrc) updates.isrc = matchingTrack.isrc;
    if (!row.url && matchingTrack.url) updates.url = matchingTrack.url;
    if (!row.imageUrl && matchingTrack.imageUrl) updates.imageUrl = matchingTrack.imageUrl;
    if (!row.album && matchingTrack.album) updates.album = matchingTrack.album;
    if (!row.durationMs && matchingTrack.durationMs) updates.durationMs = matchingTrack.durationMs;
    if (!row.titleNormalized) {
      const fp = fingerprintParts(matchingTrack);
      if (fp.titleNormalized) updates.titleNormalized = fp.titleNormalized;
      if (fp.artistNormalized) updates.artistNormalized = fp.artistNormalized;
      if (fp.durationBucket != null) updates.durationBucket = fp.durationBucket;
    }
    if (Object.keys(updates).length) {
      staleUpdates.push(
        prisma.serviceTrack.update({ where: { id: row.id }, data: updates }).then((updated) => {
          result.set(`${matchingTrack.sourceService}::${matchingTrack.sourceTrackId}`, updated);
        }),
      );
    }
  }
  if (staleUpdates.length) {
    await Promise.all(staleUpdates).catch((error) => {
      console.warn("[bulkUpsertServiceTracks] stale field backfill failed", error);
    });
  }
  return result;
}

export function lookupStoredMatch(ctx: MatchContext, internalTrackId: string) {
  const stored = ctx.storedMatchByInternalId.get(internalTrackId);
  if (!stored) return undefined;
  const track = stored.serviceTrack;
  const effectiveConfidence = stored.status === "CONFIRMED" ? 1 : stored.confidence;
  return {
    track: {
      title: track.title,
      artists: parseArtistsJson(track.artistsJson),
      album: track.album || undefined,
      durationMs: track.durationMs || undefined,
      isrc: track.isrc || undefined,
      sourceService: serviceKey(track.service),
      sourceTrackId: track.serviceTrackId,
      url: track.url || undefined,
    } satisfies NormalizedTrack,
    confidence: effectiveConfidence,
    status: stored.status,
  };
}
