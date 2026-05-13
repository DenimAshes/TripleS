import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { getCachedYouTubePlaylists, refreshYouTubePlaylists } from "@/lib/services/youtube/youtubeCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const force = new URL(request.url).searchParams.get("refresh") === "1";

  try {
    const result = force
      ? await refreshYouTubePlaylists(session.userId)
      : await getCachedYouTubePlaylists(session.userId);
    return NextResponse.json({
      playlists: result.playlists,
      lastSyncedAt: result.lastSyncedAt,
      fromCache: result.fromCache,
      isStale: result.isStale,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load YouTube playlists" }, { status: 500 });
  }
}
