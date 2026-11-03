import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import { refreshYouTubePlaylistTracks } from "./youtubeCache";

export type YouTubeTrackRefreshJob = {
  id: string;
  userId: string;
  playlistId: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  finishedAt: Date | null;
  tracks: NormalizedTrack[];
  lastFetchedAt: Date | null;
  error: string | null;
};

const jobs = new Map<string, YouTubeTrackRefreshJob>();
const runningByPlaylist = new Map<string, string>();
const FINISHED_JOB_TTL_MS = 60 * 60 * 1000;
const MAX_RETAINED_JOBS = 200;

function pruneJobs(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt.getTime() > FINISHED_JOB_TTL_MS) jobs.delete(id);
  }
  if (jobs.size <= MAX_RETAINED_JOBS) return;
  const finished = Array.from(jobs.values())
    .filter((job) => job.finishedAt)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  for (const job of finished) {
    if (jobs.size <= MAX_RETAINED_JOBS) break;
    jobs.delete(job.id);
  }
}

function jobKey(userId: string, playlistId: string) {
  return `${userId}:${playlistId}`;
}

export function getYouTubeTrackRefreshJob(userId: string, playlistId: string): YouTubeTrackRefreshJob | null {
  pruneJobs();
  const runningId = runningByPlaylist.get(jobKey(userId, playlistId));
  if (runningId) return jobs.get(runningId) || null;

  const recent = Array.from(jobs.values())
    .filter((job) => job.userId === userId && job.playlistId === playlistId)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  return recent || null;
}

export function startYouTubeTrackRefreshJob(userId: string, playlistId: string): YouTubeTrackRefreshJob {
  pruneJobs();
  const key = jobKey(userId, playlistId);
  const runningId = runningByPlaylist.get(key);
  const running = runningId ? jobs.get(runningId) : null;
  if (running && running.status === "running") return running;

  const job: YouTubeTrackRefreshJob = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId,
    playlistId,
    status: "running",
    startedAt: new Date(),
    finishedAt: null,
    tracks: [],
    lastFetchedAt: null,
    error: null,
  };

  jobs.set(job.id, job);
  runningByPlaylist.set(key, job.id);

  void refreshYouTubePlaylistTracks(userId, playlistId)
    .then((result) => {
      jobs.set(job.id, {
        ...job,
        status: "completed",
        finishedAt: new Date(),
        tracks: result.tracks,
        lastFetchedAt: result.lastFetchedAt,
      });
    })
    .catch((error) => {
      jobs.set(job.id, {
        ...job,
        status: "failed",
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      runningByPlaylist.delete(key);
    });

  return job;
}
