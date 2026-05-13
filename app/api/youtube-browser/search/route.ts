import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { cachedSearchTracks } from "@/lib/services/searchCache";
import { searchYouTubeTracksCli } from "@/lib/services/youtube/youtubeBrowserCli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  await requireAuth(request);

  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  if (!query) return NextResponse.json({ error: "q is required" }, { status: 400 });

  try {
    return NextResponse.json({ tracks: await cachedSearchTracks("youtube", query, () => searchYouTubeTracksCli(query)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not search YouTube Music" }, { status: 500 });
  }
}
