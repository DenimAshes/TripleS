import { prisma } from "@/lib/db/prisma";
import type { ServiceKey } from "@/lib/sync/syncTypes";
import { serviceKey } from "./adapterFactory";
import { syncPlaylistTracksToDb } from "./playlistTracksStore";

const STALE_AFTER_MS = Number(process.env.PLAYLIST_TRACKS_WARMUP_TTL_HOURS || 24) * 3600_000;
const WARMUP_LIMIT = Number(process.env.PLAYLIST_TRACKS_WARMUP_LIMIT || 30);

type WarmupResult = {
  checked: number;
  refreshed: number;
  failed: number;
};

function shouldRefresh(lastFetchedAt: Date | null, activeTrackCount: number): boolean {
  return activeTrackCount === 0 || !lastFetchedAt || Date.now() - lastFetchedAt.getTime() > STALE_AFTER_MS;
}

export async function warmupPlaylistTracks(userId: string): Promise<WarmupResult> {
  const playlists = await prisma.playlist.findMany({
    where: { userId },
    orderBy: [{ lastFetchedAt: "asc" }, { updatedAt: "desc" }],
    take: WARMUP_LIMIT,
  });

  const result: WarmupResult = { checked: playlists.length, refreshed: 0, failed: 0 };
  if (!playlists.length) return result;

  const counts = await prisma.playlistTrackState.groupBy({
    by: ["playlistId"],
    where: { playlistId: { in: playlists.map((p) => p.id) }, removedAt: null },
    _count: { _all: true },
  });
  const activeCountByPlaylistId = new Map(counts.map((row) => [row.playlistId, row._count._all]));

  for (const playlist of playlists) {
    const activeTrackCount = activeCountByPlaylistId.get(playlist.id) ?? 0;
    if (!shouldRefresh(playlist.lastFetchedAt, activeTrackCount)) continue;

    try {
      await syncPlaylistTracksToDb(userId, serviceKey(playlist.service) as ServiceKey, playlist.servicePlaylistId);
      result.refreshed += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
