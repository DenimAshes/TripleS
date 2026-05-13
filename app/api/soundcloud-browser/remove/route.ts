import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { removeSoundCloudTrackFromPlaylistCli } from "@/lib/services/soundcloud/soundCloudBrowserCli";
import { invalidateSoundCloudPlaylistTracks } from "@/lib/services/soundcloud/soundcloudCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  if (!body.playlistId || !body.trackId) return NextResponse.json({ error: "playlistId and trackId are required" }, { status: 400 });

  try {
    const result = await removeSoundCloudTrackFromPlaylistCli(String(body.playlistId), String(body.trackId));
    if (result.removed) await invalidateSoundCloudPlaylistTracks(String(body.playlistId));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove SoundCloud track" }, { status: 502 });
  }
}
