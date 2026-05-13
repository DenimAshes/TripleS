import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { getYouTubeTrackRefreshJob, startYouTubeTrackRefreshJob } from "@/lib/services/youtube/youtubeRefreshJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function serializeJob(job: ReturnType<typeof startYouTubeTrackRefreshJob>) {
  return {
    id: job.id,
    playlistId: job.playlistId,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    tracks: job.tracks,
    lastFetchedAt: job.lastFetchedAt,
    error: job.error,
  };
}

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const playlistId = new URL(request.url).searchParams.get("playlistId");
  if (!playlistId) return NextResponse.json({ error: "playlistId is required" }, { status: 400 });

  const job = getYouTubeTrackRefreshJob(session.userId, playlistId);
  return NextResponse.json({ job: job ? serializeJob(job) : null });
}

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  if (!body.playlistId) return NextResponse.json({ error: "playlistId is required" }, { status: 400 });

  const job = startYouTubeTrackRefreshJob(session.userId, String(body.playlistId));
  return NextResponse.json({ job: serializeJob(job) });
}
