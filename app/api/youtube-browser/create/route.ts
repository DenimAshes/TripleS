import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { BrowserLabRequestError, parseYouTubeCreateRequest } from "@/lib/services/browserLabRequest";
import { createYouTubePlaylistCli } from "@/lib/services/youtube/youtubeBrowserCli";
import { storeCreatedYouTubePlaylist } from "@/lib/services/youtube/youtubeCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));

  try {
    const input = parseYouTubeCreateRequest(body);
    const playlist = await createYouTubePlaylistCli(input.name);
    await storeCreatedYouTubePlaylist(session.userId, playlist);
    return NextResponse.json({ ok: true, playlist });
  } catch (error) {
    if (error instanceof BrowserLabRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create YouTube playlist" },
      { status: 500 },
    );
  }
}
