import { prisma } from "@/lib/db/prisma";
import { getAdapter, serviceEnum } from "./adapterFactory";
import type { NormalizedTrack, ServiceKey } from "@/lib/sync/syncTypes";

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

export async function syncPlaylistTracksToDb(userId: string, service: ServiceKey, servicePlaylistId: string) {
  const playlist = await prisma.playlist.findUnique({
    where: { service_servicePlaylistId: { service: serviceEnum(service), servicePlaylistId } },
  });
  if (!playlist || playlist.userId !== userId) {
    throw new Error("Playlist not found");
  }

  const adapter = getAdapter(service, userId);
  const tracks = await adapter.getPlaylistTracks(servicePlaylistId);
  const now = new Date();

  const seenServiceTrackIds = new Set<string>();
  let position = 0;

  for (const track of tracks) {
    position += 1;
    const serviceTrack = await upsertServiceTrack(track);
    seenServiceTrackIds.add(serviceTrack.id);

    const existing = await prisma.playlistTrackState.findFirst({
      where: { playlistId: playlist.id, serviceTrackId: serviceTrack.id, removedAt: null },
    });

    if (existing) {
      await prisma.playlistTrackState.update({
        where: { id: existing.id },
        data: { position, lastSeenAt: now },
      });
    } else {
      await prisma.playlistTrackState.create({
        data: {
          playlistId: playlist.id,
          serviceTrackId: serviceTrack.id,
          position,
          addedBySystem: false,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });
    }
  }

  const stale = await prisma.playlistTrackState.findMany({
    where: { playlistId: playlist.id, removedAt: null },
  });
  for (const state of stale) {
    if (!seenServiceTrackIds.has(state.serviceTrackId)) {
      await prisma.playlistTrackState.update({
        where: { id: state.id },
        data: { removedAt: now },
      });
    }
  }

  await prisma.playlist.update({
    where: { id: playlist.id },
    data: {
      trackCount: tracks.length,
      lastFetchedAt: now,
    },
  });

  return { count: tracks.length, playlistId: playlist.id };
}

export async function getCachedPlaylistTracks(playlistRowId: string) {
  return prisma.playlistTrackState.findMany({
    where: { playlistId: playlistRowId, removedAt: null },
    orderBy: { position: "asc" },
    include: { serviceTrack: true },
  });
}

