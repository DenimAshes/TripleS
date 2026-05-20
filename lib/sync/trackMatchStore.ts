import { Prisma, type ServiceTrack } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { NormalizedTrack } from "./syncTypes";
import { serviceKey } from "@/lib/services/adapterFactory";
import { parseArtistsJson } from "@/lib/utils/parseArtists";

function trackMatchField(service: string) {
  if (service === "SPOTIFY") return "spotifyServiceTrackId";
  if (service === "YOUTUBE") return "youtubeServiceTrackId";
  return "soundcloudServiceTrackId";
}

function normalizedFromServiceTrack(track: ServiceTrack): NormalizedTrack {
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

export function buildTrackMatchData(
  sourceService: string,
  destinationService: string,
  sourceServiceTrackId: string,
  targetServiceTrackId: string,
) {
  return {
    [trackMatchField(sourceService)]: sourceServiceTrackId,
    [trackMatchField(destinationService)]: targetServiceTrackId,
  };
}

// Stored matches go stale: a SC track can be removed, made private, or
// the user can have a since-deleted match that we keep happily reusing.
// Skip rows that haven't been verified within the freshness window;
// callers fall back to live search and will re-write verifiedAt when the
// add actually lands.
const MATCH_FRESHNESS_MS = Math.max(
  0,
  Number(process.env.MATCH_FRESHNESS_DAYS ?? 30) * 24 * 60 * 60_000,
);

export async function findStoredDestinationMatch(internalTrackId: string, destinationService: string) {
  const destinationField = trackMatchField(destinationService);
  const stored = await prisma.trackMatch.findFirst({
    where: {
      internalTrackId,
      [destinationField]: { not: null },
      status: { in: ["CONFIRMED", "AUTO_MATCHED"] },
    },
    orderBy: [{ status: "desc" }, { confidence: "desc" }],
  });

  const serviceTrackId = stored?.[destinationField as keyof typeof stored];
  if (!stored || typeof serviceTrackId !== "string") return null;

  // CONFIRMED matches come from a user picking the candidate by hand, so we
  // trust them indefinitely. AUTO_MATCHED rows can drift; re-validate when
  // older than MATCH_FRESHNESS_DAYS by returning null so the caller falls
  // back to search.
  if (
    stored.status === "AUTO_MATCHED" &&
    MATCH_FRESHNESS_MS > 0 &&
    (!stored.verifiedAt || Date.now() - stored.verifiedAt.getTime() > MATCH_FRESHNESS_MS)
  ) {
    return null;
  }

  const track = await prisma.serviceTrack.findUnique({ where: { id: serviceTrackId } });
  if (!track) return null;

  return {
    track: normalizedFromServiceTrack(track),
    confidence: stored.confidence,
    status: stored.status,
  };
}

export async function markTrackMatchVerified(matchId: string): Promise<void> {
  await prisma.trackMatch
    .update({ where: { id: matchId }, data: { verifiedAt: new Date() } })
    .catch(() => undefined);
}

export async function upsertAutoTrackMatch({
  internalTrackId,
  sourceService,
  destinationService,
  sourceServiceTrackId,
  targetServiceTrackId,
  confidence,
  status = "AUTO_MATCHED",
}: {
  internalTrackId: string;
  sourceService: string;
  destinationService: string;
  sourceServiceTrackId: string;
  targetServiceTrackId: string;
  confidence: number;
  status?: "AUTO_MATCHED" | "CONFIRMED";
}) {
  const destinationField = trackMatchField(destinationService);
  const existing = await prisma.trackMatch.findFirst({
    where: {
      internalTrackId,
      [destinationField]: targetServiceTrackId,
      status: { in: ["AUTO_MATCHED", "CONFIRMED"] },
    },
  });

  if (existing) {
    return prisma.trackMatch.update({
      where: { id: existing.id },
      data: {
        confidence: Math.max(existing.confidence, confidence),
        status: existing.status === "CONFIRMED" || status === "CONFIRMED" ? "CONFIRMED" : "AUTO_MATCHED",
        verifiedAt: new Date(),
      },
    });
  }

  try {
    return await prisma.trackMatch.create({
      data: {
        internalTrackId,
        ...buildTrackMatchData(sourceService, destinationService, sourceServiceTrackId, targetServiceTrackId),
        confidence,
        status,
        verifiedAt: new Date(),
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const raced = await prisma.trackMatch.findFirst({
      where: {
        internalTrackId,
        [destinationField]: targetServiceTrackId,
        status: { in: ["AUTO_MATCHED", "CONFIRMED"] },
      },
    });
    if (!raced) throw error;
    return prisma.trackMatch.update({
      where: { id: raced.id },
      data: {
        confidence: Math.max(raced.confidence, confidence),
        status: raced.status === "CONFIRMED" || status === "CONFIRMED" ? "CONFIRMED" : "AUTO_MATCHED",
        verifiedAt: new Date(),
      },
    });
  }
}
