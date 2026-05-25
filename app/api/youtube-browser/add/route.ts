import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { addFirstSearchResultToPlaylistCli } from "@/lib/services/youtube/youtubeBrowserCli";
import { invalidateYouTubePlaylistTracks } from "@/lib/services/youtube/youtubeCache";
import { BrowserLabRequestError, parseYouTubeAddRequest } from "@/lib/services/browserLabRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  await requireAuth(request);

  const body = await request.json().catch(() => ({}));
  let input: ReturnType<typeof parseYouTubeAddRequest>;
  try {
    input = parseYouTubeAddRequest(body);
  } catch (error) {
    if (error instanceof BrowserLabRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  try {
    const result = await addFirstSearchResultToPlaylistCli(input.playlistId, input.query);
    if (result.added) await invalidateYouTubePlaylistTracks(input.playlistId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add track" }, { status: 500 });
  }
}
