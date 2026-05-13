import { prisma } from "@/lib/db/prisma";
import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import { upsertServiceTrack } from "@/lib/services/playlistTracksStore";
import { listYouTubePlaylistsCli, listYouTubePlaylistTracksCli, type YtPlaylist } from "./youtubeBrowserCli";

const SERVICE = "youtube";
const HOUR_MS = 3600_000;
const PLAYLISTS_TTL_MS = Number(process.env.YT_PLAYLISTS_TTL_HOURS || 24) * HOUR_MS;
const TRACKS_TTL_MS = Number(process.env.YT_TRACKS_TTL_HOURS || 24) * HOUR_MS;
const PLAYLISTS_MEMORY_TTL_MS = Number(process.env.YT_PLAYLISTS_MEMORY_TTL_SECONDS || 300) * 1000;
const TRACKS_MEMORY_TTL_MS = Number(process.env.YT_TRACKS_MEMORY_TTL_SECONDS || 300) * 1000;

export type CachedPlaylists = {
  playlists: YtPlaylist[];
  lastSyncedAt: Date | null;
  fromCache: boolean;
  isStale: boolean;
};

export type CachedTracks = {
  tracks: NormalizedTrack[];
  lastFetchedAt: Date | null;
  fromCache: boolean;
  isStale: boolean;
};

const playlistMemoryCache = new Map<string, { expiresAt: number; value: CachedPlaylists }>();
const tracksMemoryCache = new Map<string, { expiresAt: number; value: CachedTracks }>();

function rowsToYtPlaylists(rows: Array<{ servicePlaylistId: string; name: string; trackCount: number; imageUrl: string | null }>): YtPlaylist[] {
  return rows.map((row) => ({
    id: row.servicePlaylistId,
    name: row.name,
    trackCount: row.trackCount,
    imageUrl: row.imageUrl ?? undefined,
  }));
}

export async function getCachedYouTubePlaylists(userId: string, options: { force?: boolean } = {}): Promise<CachedPlaylists> {
  if (!options.force) {
    const memory = playlistMemoryCache.get(userId);
    if (memory && memory.expiresAt > Date.now()) {
      return memory.value;
    }
  }

  const rows = await prisma.playlist.findMany({
    where: { userId, service: SERVICE },
    orderBy: { name: "asc" },
  });

  const lastSyncedAt = rows.reduce<Date | null>((acc, row) => (acc && acc > row.updatedAt ? acc : row.updatedAt), null);
  const stale = !lastSyncedAt || Date.now() - lastSyncedAt.getTime() > PLAYLISTS_TTL_MS;

  if (!options.force) {
    const value = { playlists: rowsToYtPlaylists(rows), lastSyncedAt, fromCache: true, isStale: stale };
    playlistMemoryCache.set(userId, { value, expiresAt: Date.now() + PLAYLISTS_MEMORY_TTL_MS });
    return value;
  }

  return refreshYouTubePlaylists(userId);
}

export async function refreshYouTubePlaylists(userId: string): Promise<CachedPlaylists> {
  const live = await listYouTubePlaylistsCli();
  const now = new Date();

  for (const item of live) {
    await prisma.playlist.upsert({
      where: { service_servicePlaylistId: { service: SERVICE, servicePlaylistId: item.id } },
      update: {
        userId,
        name: item.name,
        imageUrl: item.imageUrl,
        trackCount: item.trackCount,
        isWritable: true,
      },
      create: {
        userId,
        service: SERVICE,
        servicePlaylistId: item.id,
        name: item.name,
        imageUrl: item.imageUrl,
        trackCount: item.trackCount,
        isWritable: true,
      },
    });
  }

  const liveIds = new Set(live.map((p) => p.id));
  const stalePlaylists = await prisma.playlist.findMany({
    where: { userId, service: SERVICE, servicePlaylistId: { notIn: [...liveIds] } },
    select: { id: true },
  });
  if (stalePlaylists.length > 0) {
    await prisma.playlist.deleteMany({ where: { id: { in: stalePlaylists.map((p) => p.id) } } });
  }

  const rows = await prisma.playlist.findMany({
    where: { userId, service: SERVICE },
    orderBy: { name: "asc" },
  });
  const value = { playlists: rowsToYtPlaylists(rows), lastSyncedAt: now, fromCache: false, isStale: false };
  playlistMemoryCache.set(userId, { value, expiresAt: Date.now() + PLAYLISTS_MEMORY_TTL_MS });
  return value;
}

type ServiceTrackRow = {
  serviceTrackId: string;
  title: string;
  artistsJson: string;
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  url: string | null;
  imageUrl?: string | null;
};

function rowsToTracks(rows: Array<{ serviceTrack: ServiceTrackRow }>): NormalizedTrack[] {
  return rows.map(({ serviceTrack }) => ({
    title: serviceTrack.title,
    artists: safeParseArtists(serviceTrack.artistsJson),
    album: serviceTrack.album ?? undefined,
    durationMs: serviceTrack.durationMs ?? undefined,
    isrc: serviceTrack.isrc ?? undefined,
    sourceService: "youtube",
    sourceTrackId: serviceTrack.serviceTrackId,
    url: serviceTrack.url ?? `https://music.youtube.com/watch?v=${serviceTrack.serviceTrackId}`,
    imageUrl: serviceTrack.imageUrl ?? undefined,
  }));
}

function safeParseArtists(json: string): string[] {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function getCachedYouTubeTracks(userId: string, servicePlaylistId: string, options: { force?: boolean } = {}): Promise<CachedTracks> {
  const cacheKey = `${userId}:${servicePlaylistId}`;
  if (!options.force) {
    const memory = tracksMemoryCache.get(cacheKey);
    if (memory && memory.expiresAt > Date.now()) {
      return memory.value;
    }
  }

  const playlist = await prisma.playlist.findUnique({
    where: { service_servicePlaylistId: { service: SERVICE, servicePlaylistId } },
  });
  if (!playlist || playlist.userId !== userId) {
    return { tracks: [], lastFetchedAt: null, fromCache: true, isStale: true };
  }

  const stale = !playlist.lastFetchedAt || Date.now() - playlist.lastFetchedAt.getTime() > TRACKS_TTL_MS;
  if (!options.force) {
    const states = await prisma.playlistTrackState.findMany({
      where: { playlistId: playlist.id, removedAt: null },
      orderBy: { position: "asc" },
      include: { serviceTrack: true },
    });
    const value = { tracks: rowsToTracks(states), lastFetchedAt: playlist.lastFetchedAt, fromCache: true, isStale: stale };
    tracksMemoryCache.set(cacheKey, { value, expiresAt: Date.now() + TRACKS_MEMORY_TTL_MS });
    return value;
  }

  return refreshYouTubePlaylistTracks(userId, servicePlaylistId);
}

export async function refreshYouTubePlaylistTracks(userId: string, servicePlaylistId: string): Promise<CachedTracks> {
  const playlist = await prisma.playlist.findUnique({
    where: { service_servicePlaylistId: { service: SERVICE, servicePlaylistId } },
  });
  if (!playlist || playlist.userId !== userId) {
    throw new Error("Playlist not found for this user. Refresh playlists first.");
  }

  const live = await listYouTubePlaylistTracksCli(servicePlaylistId);
  const now = new Date();

  const seenServiceTrackIds = new Set<string>();
  let position = 0;
  for (const track of live) {
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

  const active = await prisma.playlistTrackState.findMany({
    where: { playlistId: playlist.id, removedAt: null },
    select: { id: true, serviceTrackId: true },
  });
  const removedIds = active.filter((row) => !seenServiceTrackIds.has(row.serviceTrackId)).map((row) => row.id);
  if (removedIds.length > 0) {
    await prisma.playlistTrackState.deleteMany({ where: { id: { in: removedIds } } });
  }

  await prisma.playlist.update({
    where: { id: playlist.id },
    data: { trackCount: live.length, lastFetchedAt: now },
  });

  const value = { tracks: live, lastFetchedAt: now, fromCache: false, isStale: false };
  tracksMemoryCache.set(`${userId}:${servicePlaylistId}`, { value, expiresAt: Date.now() + TRACKS_MEMORY_TTL_MS });
  return value;
}

export async function invalidateYouTubePlaylistTracks(servicePlaylistId: string): Promise<void> {
  await prisma.playlist.updateMany({
    where: { service: SERVICE, servicePlaylistId },
    data: { lastFetchedAt: null },
  });
  for (const key of tracksMemoryCache.keys()) {
    if (key.endsWith(`:${servicePlaylistId}`)) tracksMemoryCache.delete(key);
  }
}
