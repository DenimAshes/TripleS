import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { removeTrackFromPlaylistCli } from "@/lib/services/youtube/youtubeBrowserCli";
import { invalidateYouTubePlaylistTracks } from "@/lib/services/youtube/youtubeCache";
import { BrowserLabRequestError, parseYouTubeRemoveRequest } from "@/lib/services/browserLabRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  await requireAuth(request);

  const body = await request.json().catch(() => ({}));
  let input: ReturnType<typeof parseYouTubeRemoveRequest>;
  try {
    input = parseYouTubeRemoveRequest(body);
  } catch (error) {
    if (error instanceof BrowserLabRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  try {
    await removeTrackFromPlaylistCli(input.playlistId, input.trackText);
    await invalidateYouTubePlaylistTracks(input.playlistId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove track" }, { status: 500 });
  }
}
