import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { getCachedYouTubeTracks, refreshYouTubePlaylistTracks } from "@/lib/services/youtube/youtubeCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const url = new URL(request.url);
  const playlistId = url.searchParams.get("playlistId");
  const force = url.searchParams.get("refresh") === "1";
  if (!playlistId) return NextResponse.json({ error: "playlistId is required" }, { status: 400 });

  try {
    const result = force
      ? await refreshYouTubePlaylistTracks(session.userId, playlistId)
      : await getCachedYouTubeTracks(session.userId, playlistId);
    return NextResponse.json({
      tracks: result.tracks,
      lastFetchedAt: result.lastFetchedAt,
      fromCache: result.fromCache,
      isStale: result.isStale,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load YouTube tracks" }, { status: 500 });
  }
}
