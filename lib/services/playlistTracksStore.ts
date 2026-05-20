import { prisma } from "@/lib/db/prisma";
import { getAdapter, serviceEnum } from "./adapterFactory";
import type { NormalizedTrack, ServiceKey } from "@/lib/sync/syncTypes";
import { isReadComplete, writePlaylistSnapshot } from "@/lib/sync/snapshot";

const READ_PROGRESS_INTERVAL_MS = 5_000;

export type PlaylistTrackSyncProgress = {
  phase: "reading" | "tracks" | "serviceTracks" | "cache" | "done";
  current: number;
  total: number;
  elapsedMs?: number;
};

// TODO: migrate youtubeCache/soundcloudCache callers to bulkUpsertServiceTracks
// so this dumb non-ISRC-aware upsert can be removed.
export async function upsertServiceTrack(track: NormalizedTrack) {
  const internal = await prisma.internalTrack.upsert({
    where: { id: `${track.sourceService}_${track.sourceTrackId}` },
    update: {},
    create: {
      id: `${track.sourceService}_${track.sourceTrackId}`,
      canonicalTitle: track.title,
      canonicalArtists: JSON.stringify(track.artists),
      canonicalAlbum: track.album,
      durationMs: track.durationMs,
      isrc: track.isrc,
    },
  });
  return prisma.serviceTrack.upsert({
    where: { service_serviceTrackId: { service: serviceEnum(track.sourceService), serviceTrackId: track.sourceTrackId } },
    update: {
      title: track.title,
      artistsJson: JSON.stringify(track.artists),
      album: track.album,
      durationMs: track.durationMs,
      isrc: track.isrc,
      url: track.url,
      imageUrl: track.imageUrl,
    },
    create: {
      internalTrackId: internal.id,
      service: serviceEnum(track.sourceService),
      serviceTrackId: track.sourceTrackId,
      title: track.title,
      artistsJson: JSON.stringify(track.artists),
      album: track.album,
      durationMs: track.durationMs,
      isrc: track.isrc,
      url: track.url,
      imageUrl: track.imageUrl,
    },
  });
}

export async function syncPlaylistTracksToDb(
  userId: string,
  service: ServiceKey,
  servicePlaylistId: string,
  onProgress?: (progress: PlaylistTrackSyncProgress) => Promise<void> | void,
) {
  const playlist = await prisma.playlist.findUnique({
    where: { service_servicePlaylistId: { service: serviceEnum(service), servicePlaylistId } },
  });
  if (!playlist || playlist.userId !== userId) {
    throw new Error("Playlist not found");
  }

  const adapter = getAdapter(service, userId);
  const expectedReadCount = playlist.trackCount ?? 0;
  await onProgress?.({ phase: "reading", current: 0, total: expectedReadCount, elapsedMs: 0 });
  let readProgressTimer: ReturnType<typeof setInterval> | null = null;
  if (onProgress) {
    const startedAt = Date.now();
    readProgressTimer = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      void Promise.resolve(
        onProgress({ phase: "reading", current: Math.floor(elapsedMs / 1000), total: expectedReadCount, elapsedMs }),
      ).catch(() => {});
    }, READ_PROGRESS_INTERVAL_MS);
    readProgressTimer.unref?.();
  }
  let tracks: NormalizedTrack[];
  try {
    tracks = await adapter.getPlaylistTracks(servicePlaylistId);
  } finally {
    if (readProgressTimer) clearInterval(readProgressTimer);
  }
  await onProgress?.({ phase: "tracks", current: tracks.length, total: tracks.length });

  const activeStateCount = await prisma.playlistTrackState.count({
    where: { playlistId: playlist.id, removedAt: null },
  });
  const expected = Math.max(playlist.trackCount ?? 0, activeStateCount);
  if (!isReadComplete(tracks.length, expected)) {
    return {
      skipped: true as const,
      reason: `partial-read (${tracks.length}/${expected})`,
      count: tracks.length,
      playlistId: playlist.id,
    };
  }

  const result = await writePlaylistSnapshot(playlist.id, tracks, {
    expectedCount: expected,
    allowPartial: true,
    onProgress: (phase, current, total) =>
      onProgress?.({ phase, current, total }),
  });
  if (!result.stored) {
    return {
      skipped: true as const,
      reason: result.reason,
      count: result.count,
      playlistId: playlist.id,
    };
  }

  await onProgress?.({ phase: "done", current: result.count, total: result.count });
  return { count: result.count, playlistId: playlist.id };
}

export async function getCachedPlaylistTracks(playlistRowId: string) {
  return prisma.playlistTrackState.findMany({
    where: { playlistId: playlistRowId, removedAt: null },
    orderBy: { position: "asc" },
    include: { serviceTrack: true },
  });
}

