import { prisma } from "@/lib/db/prisma";
import type { MusicServiceAdapter } from "@/lib/services/MusicServiceAdapter";
import { serviceEnum } from "@/lib/services/adapterFactory";
import type { NormalizedTrack, ServiceKey } from "./syncTypes";
import { normalizeArtist, normalizeTitle } from "@/lib/utils/normalizeTrack";
import { calculateSimilarity } from "@/lib/utils/similarity";

export async function findMatch(
  sourceTrack: NormalizedTrack,
  targetService: ServiceKey,
  adapter: MusicServiceAdapter,
) {
  if (sourceTrack.isrc) {
    const dbMatch = await prisma.serviceTrack.findFirst({
      where: { service: serviceEnum(targetService), isrc: sourceTrack.isrc },
    });
    if (dbMatch) {
      return {
        track: {
          title: dbMatch.title,
          artists: JSON.parse(dbMatch.artistsJson),
          album: dbMatch.album || undefined,
          durationMs: dbMatch.durationMs || undefined,
          isrc: dbMatch.isrc || undefined,
          sourceService: targetService,
          sourceTrackId: dbMatch.serviceTrackId,
          url: dbMatch.url || undefined,
        },
        confidence: 1,
      };
    }
  }

  const query = `${normalizeTitle(sourceTrack.title)} ${normalizeArtist(sourceTrack.artists[0] || "")}`;
  const candidates = await adapter.searchTrack({ query, isrc: sourceTrack.isrc });
  const ranked = rankCandidates(sourceTrack, candidates);
  const best = ranked[0] || null;
  return best;
}

export function rankCandidates(sourceTrack: NormalizedTrack, candidates: NormalizedTrack[]) {
  return candidates
    .map((track) => ({ track, confidence: calculateSimilarity(sourceTrack, track) }))
    .sort((a, b) => b.confidence - a.confidence);
}

export { calculateSimilarity, normalizeArtist, normalizeTitle };
