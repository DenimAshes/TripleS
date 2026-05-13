import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { addFirstSearchResultToPlaylistCli } from "@/lib/services/youtube/youtubeBrowserCli";
import { invalidateYouTubePlaylistTracks } from "@/lib/services/youtube/youtubeCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  await requireAuth(request);

  const body = await request.json().catch(() => ({}));
  if (!body.playlistId || !body.query) return NextResponse.json({ error: "playlistId and query are required" }, { status: 400 });

  try {
    const result = await addFirstSearchResultToPlaylistCli(String(body.playlistId), String(body.query));
    if (result.added) await invalidateYouTubePlaylistTracks(String(body.playlistId));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add track" }, { status: 500 });
  }
}
