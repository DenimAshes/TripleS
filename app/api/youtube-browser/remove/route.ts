import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { removeTrackFromPlaylistCli } from "@/lib/services/youtube/youtubeBrowserCli";
import { invalidateYouTubePlaylistTracks } from "@/lib/services/youtube/youtubeCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  await requireAuth(request);

  const body = await request.json().catch(() => ({}));
  if (!body.playlistId || !body.trackText) return NextResponse.json({ error: "playlistId and trackText are required" }, { status: 400 });

  try {
    await removeTrackFromPlaylistCli(String(body.playlistId), String(body.trackText));
    await invalidateYouTubePlaylistTracks(String(body.playlistId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove track" }, { status: 500 });
  }
}
