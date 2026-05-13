import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { cachedSearchTracks } from "@/lib/services/searchCache";
import { searchSoundCloudTracksCli } from "@/lib/services/soundcloud/soundCloudBrowserCli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  await requireAuth(request);
  const query = new URL(request.url).searchParams.get("q");
  if (!query) return NextResponse.json({ error: "q is required" }, { status: 400 });

  try {
    return NextResponse.json({ tracks: await cachedSearchTracks("soundcloud", query, () => searchSoundCloudTracksCli(query)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not search SoundCloud" }, { status: 500 });
  }
}
