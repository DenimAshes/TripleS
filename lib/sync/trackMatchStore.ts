import { Prisma, type ServiceTrack } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { NormalizedTrack } from "./syncTypes";
import { serviceKey } from "@/lib/services/adapterFactory";

function trackMatchField(service: string) {
  if (service === "SPOTIFY") return "spotifyServiceTrackId";
  if (service === "YOUTUBE") return "youtubeServiceTrackId";
  return "soundcloudServiceTrackId";
}

function normalizedFromServiceTrack(track: ServiceTrack): NormalizedTrack {
  return {
    title: track.title,
    artists: JSON.parse(track.artistsJson),
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

  const track = await prisma.serviceTrack.findUnique({ where: { id: serviceTrackId } });
  if (!track) return null;

  return {
    track: normalizedFromServiceTrack(track),
    confidence: stored.confidence,
    status: stored.status,
  };
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
      },
    });
  }
}
