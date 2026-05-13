import { refreshAllPlaylists } from "./playlistRefresh";
import { warmupPlaylistTracks } from "./playlistTrackWarmup";

type PlaylistRefreshJob = {
  userId: string;
  startedAt: number;
  finishedAt: number | null;
  ok: boolean | null;
};

const jobs = new Map<string, PlaylistRefreshJob>();
const RECENT_FINISH_TTL_MS = Number(process.env.PLAYLIST_REFRESH_COOLDOWN_SECONDS || 300) * 1000;

export function startPlaylistRefreshJob(userId: string): PlaylistRefreshJob {
  const existing = jobs.get(userId);
  if (existing && !existing.finishedAt) return existing;
  if (existing?.finishedAt && Date.now() - existing.finishedAt < RECENT_FINISH_TTL_MS) return existing;

  const job: PlaylistRefreshJob = {
    userId,
    startedAt: Date.now(),
    finishedAt: null,
    ok: null,
  };
  jobs.set(userId, job);

  void (async () => {
    try {
      await refreshAllPlaylists(userId);
      await warmupPlaylistTracks(userId);
      job.ok = true;
    } catch {
      job.ok = false;
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  return job;
}
