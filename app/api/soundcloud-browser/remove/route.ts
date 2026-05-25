import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { removeSoundCloudTrackFromPlaylistCli } from "@/lib/services/soundcloud/soundCloudBrowserCli";
import { invalidateSoundCloudPlaylistTracks } from "@/lib/services/soundcloud/soundcloudCache";
import { BrowserLabRequestError, parseSoundCloudTrackRequest } from "@/lib/services/browserLabRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  let input: ReturnType<typeof parseSoundCloudTrackRequest>;
  try {
    input = parseSoundCloudTrackRequest(body);
  } catch (error) {
    if (error instanceof BrowserLabRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  try {
    const result = await removeSoundCloudTrackFromPlaylistCli(input.playlistId, input.trackId);
    if (result.removed) await invalidateSoundCloudPlaylistTracks(input.playlistId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove SoundCloud track" }, { status: 502 });
  }
}
