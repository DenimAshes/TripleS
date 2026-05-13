import { prisma } from "@/lib/db/prisma";
import { upsertServiceTrack } from "@/lib/services/playlistTracksStore";
import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import {
  listSoundCloudPlaylistTracksCli,
  listSoundCloudPlaylistsCli,
  type SoundCloudPlaylist,
} from "./soundCloudBrowserCli";

const SERVICE = "soundcloud";
const HOUR_MS = 3600_000;
const PLAYLISTS_TTL_MS = Number(process.env.SC_PLAYLISTS_TTL_HOURS || 24) * HOUR_MS;
const TRACKS_TTL_MS = Number(process.env.SC_TRACKS_TTL_HOURS || 24) * HOUR_MS;
const PLAYLISTS_MEMORY_TTL_MS = Number(process.env.SC_PLAYLISTS_MEMORY_TTL_SECONDS || 300) * 1000;
const TRACKS_MEMORY_TTL_MS = Number(process.env.SC_TRACKS_MEMORY_TTL_SECONDS || 300) * 1000;

export type CachedSoundCloudPlaylists = {
  playlists: SoundCloudPlaylist[];
  lastSyncedAt: Date | null;
  fromCache: boolean;
  isStale: boolean;
};

export type CachedSoundCloudTracks = {
  tracks: NormalizedTrack[];
  lastFetchedAt: Date | null;
  fromCache: boolean;
  isStale: boolean;
};

const playlistMemoryCache = new Map<string, { expiresAt: number; value: CachedSoundCloudPlaylists }>();
const tracksMemoryCache = new Map<string, { expiresAt: number; value: CachedSoundCloudTracks }>();

function isDatabaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Can't reach database server|ECONNREFUSED|ETIMEDOUT|P1001|database server/i.test(message);
}

function rowsToPlaylists(
  rows: Array<{ servicePlaylistId: string; name: string; trackCount: number; imageUrl: string | null; isWritable: boolean }>,
): SoundCloudPlaylist[] {
  return rows.map((row) => ({
    id: row.servicePlaylistId,
    name: row.name,
    trackCount: row.trackCount,
    imageUrl: row.imageUrl ?? undefined,
    url: `https://soundcloud.com/${row.servicePlaylistId}`,
    isWritable: row.isWritable,
  }));
}

export async function getCachedSoundCloudPlaylists(userId: string, options: { force?: boolean } = {}): Promise<CachedSoundCloudPlaylists> {
  if (!options.force) {
    const memory = playlistMemoryCache.get(userId);
    if (memory && memory.expiresAt > Date.now()) return memory.value;
  }

  let rows: Array<{ servicePlaylistId: string; name: string; trackCount: number; imageUrl: string | null; isWritable: boolean; updatedAt: Date }>;
  try {
    rows = await prisma.playlist.findMany({
      where: { userId, service: SERVICE },
      orderBy: { name: "asc" },
    });
  } catch (error) {
    if (!isDatabaseError(error)) throw error;
    return { playlists: [], lastSyncedAt: null, fromCache: true, isStale: true };
  }
  const lastSyncedAt = rows.reduce<Date | null>((acc, row) => (acc && acc > row.updatedAt ? acc : row.updatedAt), null);
  const isStale = !lastSyncedAt || Date.now() - lastSyncedAt.getTime() > PLAYLISTS_TTL_MS;

  if (!options.force) {
    const value = { playlists: rowsToPlaylists(rows), lastSyncedAt, fromCache: true, isStale };
    playlistMemoryCache.set(userId, { value, expiresAt: Date.now() + PLAYLISTS_MEMORY_TTL_MS });
    return value;
  }

  return refreshSoundCloudPlaylists(userId);
}

export async function refreshSoundCloudPlaylists(userId: string): Promise<CachedSoundCloudPlaylists> {
  const live = await listSoundCloudPlaylistsCli();
  const now = new Date();

  try {
    for (const item of live) {
      await prisma.playlist.upsert({
        where: { service_servicePlaylistId: { service: SERVICE, servicePlaylistId: item.id } },
        update: {
          userId,
          name: item.name,
          imageUrl: item.imageUrl,
          trackCount: item.trackCount,
          isWritable: item.isWritable === true,
        },
        create: {
          userId,
          service: SERVICE,
          servicePlaylistId: item.id,
          name: item.name,
          imageUrl: item.imageUrl,
          trackCount: item.trackCount,
          isWritable: item.isWritable === true,
        },
      });
    }

    const liveIds = new Set(live.map((playlist) => playlist.id));
    const stale = await prisma.playlist.findMany({
      where: { userId, service: SERVICE, servicePlaylistId: { notIn: [...liveIds] } },
      select: { id: true },
    });
    if (stale.length > 0) {
      await prisma.playlist.deleteMany({ where: { id: { in: stale.map((playlist) => playlist.id) } } });
    }
  } catch (error) {
    if (!isDatabaseError(error)) throw error;
    const value = { playlists: live, lastSyncedAt: now, fromCache: false, isStale: false };
    playlistMemoryCache.set(userId, { value, expiresAt: Date.now() + PLAYLISTS_MEMORY_TTL_MS });
    return value;
  }

  const rows = await prisma.playlist.findMany({
    where: { userId, service: SERVICE },
    orderBy: { name: "asc" },
  });
  const value = { playlists: rowsToPlaylists(rows), lastSyncedAt: now, fromCache: false, isStale: false };
  playlistMemoryCache.set(userId, { value, expiresAt: Date.now() + PLAYLISTS_MEMORY_TTL_MS });
  return value;
}

function safeParseArtists(json: string): string[] {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function rowsToTracks(
  rows: Array<{
    serviceTrack: {
      serviceTrackId: string;
      title: string;
      artistsJson: string;
      album: string | null;
      durationMs: number | null;
      isrc: string | null;
      url: string | null;
      imageUrl: string | null;
    };
  }>,
): NormalizedTrack[] {
  return rows.map(({ serviceTrack }) => ({
    title: serviceTrack.title,
    artists: safeParseArtists(serviceTrack.artistsJson),
    album: serviceTrack.album ?? undefined,
    durationMs: serviceTrack.durationMs ?? undefined,
    isrc: serviceTrack.isrc ?? undefined,
    sourceService: "soundcloud",
    sourceTrackId: serviceTrack.serviceTrackId,
    url: serviceTrack.url ?? `https://soundcloud.com/${serviceTrack.serviceTrackId}`,
    imageUrl: serviceTrack.imageUrl ?? undefined,
  }));
}

export async function getCachedSoundCloudTracks(
  userId: string,
  servicePlaylistId: string,
  options: { force?: boolean } = {},
): Promise<CachedSoundCloudTracks> {
  const cacheKey = `${userId}:${servicePlaylistId}`;
  if (!options.force) {
    const memory = tracksMemoryCache.get(cacheKey);
    if (memory && memory.expiresAt > Date.now()) return memory.value;
  }

  let playlist;
  try {
    playlist = await prisma.playlist.findUnique({
      where: { service_servicePlaylistId: { service: SERVICE, servicePlaylistId } },
    });
  } catch (error) {
    if (!isDatabaseError(error)) throw error;
    return { tracks: [], lastFetchedAt: null, fromCache: true, isStale: true };
  }
  if (!playlist || playlist.userId !== userId) {
    return { tracks: [], lastFetchedAt: null, fromCache: true, isStale: true };
  }

  const isStale = !playlist.lastFetchedAt || Date.now() - playlist.lastFetchedAt.getTime() > TRACKS_TTL_MS;
  if (!options.force) {
    const states = await prisma.playlistTrackState.findMany({
      where: { playlistId: playlist.id, removedAt: null },
      orderBy: { position: "asc" },
      include: { serviceTrack: true },
    });
    const value = { tracks: rowsToTracks(states), lastFetchedAt: playlist.lastFetchedAt, fromCache: true, isStale };
    tracksMemoryCache.set(cacheKey, { value, expiresAt: Date.now() + TRACKS_MEMORY_TTL_MS });
    return value;
  }

  return refreshSoundCloudPlaylistTracks(userId, servicePlaylistId);
}

export async function refreshSoundCloudPlaylistTracks(userId: string, servicePlaylistId: string): Promise<CachedSoundCloudTracks> {
  const live = await listSoundCloudPlaylistTracksCli(servicePlaylistId);
  const now = new Date();

  let playlist;
  try {
    playlist = await prisma.playlist.findUnique({
      where: { service_servicePlaylistId: { service: SERVICE, servicePlaylistId } },
    });
  } catch (error) {
    if (!isDatabaseError(error)) throw error;
    const value = { tracks: live, lastFetchedAt: now, fromCache: false, isStale: false };
    tracksMemoryCache.set(`${userId}:${servicePlaylistId}`, { value, expiresAt: Date.now() + TRACKS_MEMORY_TTL_MS });
    return value;
  }
  if (!playlist || playlist.userId !== userId) {
    const value = { tracks: live, lastFetchedAt: now, fromCache: false, isStale: false };
    tracksMemoryCache.set(`${userId}:${servicePlaylistId}`, { value, expiresAt: Date.now() + TRACKS_MEMORY_TTL_MS });
    return value;
  }
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
      await prisma.playlistTrackState.update({ where: { id: existing.id }, data: { position, lastSeenAt: now } });
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

export async function invalidateSoundCloudPlaylistTracks(servicePlaylistId: string): Promise<void> {
  await prisma.playlist.updateMany({
    where: { service: SERVICE, servicePlaylistId },
    data: { lastFetchedAt: null },
  });
  for (const key of tracksMemoryCache.keys()) {
    if (key.endsWith(`:${servicePlaylistId}`)) tracksMemoryCache.delete(key);
  }
}
