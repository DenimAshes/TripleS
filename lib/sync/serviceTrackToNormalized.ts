import type { ServiceTrack } from "@prisma/client";
import { serviceKey } from "@/lib/services/adapterFactory";
import { parseArtistsJson } from "@/lib/utils/parseArtists";
import type { NormalizedTrack } from "./syncTypes";

// One mapping from a stored row to the shape the matcher scores. It used to be
// copy-pasted into the sync engine, the match store and the calibration script,
// and the copies had already drifted — so an offline score could differ from
// the score the engine computed for the same pair.
export function normalizedFromServiceTrack(track: ServiceTrack): NormalizedTrack {
  return {
    title: track.title,
    artists: parseArtistsJson(track.artistsJson),
    album: track.album || undefined,
    durationMs: track.durationMs || undefined,
    isrc: track.isrc || undefined,
    sourceService: serviceKey(track.service),
    sourceTrackId: track.serviceTrackId,
    url: track.url || undefined,
    imageUrl: track.imageUrl || undefined,
  };
}
