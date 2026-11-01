import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { BrowserLabRequestError, parseYouTubeDeleteRequest } from "@/lib/services/browserLabRequest";
import { deleteYouTubePlaylistCli } from "@/lib/services/youtube/youtubeBrowserCli";
import { removeCachedYouTubePlaylist } from "@/lib/services/youtube/youtubeCache";
import { youtubePlaylistDeleteBlocker } from "@/lib/services/youtube/youtubePlaylistDelete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));

  try {
    const input = parseYouTubeDeleteRequest(body);
    const playlist = await prisma.playlist.findUnique({
      where: { service_servicePlaylistId: { service: "YOUTUBE", servicePlaylistId: input.playlistId } },
      select: { id: true, userId: true },
    });
    if (!playlist || playlist.userId !== session.userId) {
      return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
    }

    const [groupMemberships, sourceRules, destinationRules] = await Promise.all([
      prisma.playlistGroupMember.count({ where: { playlistId: playlist.id } }),
      prisma.syncRule.count({
        where: { userId: session.userId, sourceService: "YOUTUBE", sourcePlaylistId: input.playlistId },
      }),
      prisma.syncDestination.count({
        where: { service: "YOUTUBE", playlistId: input.playlistId, syncRule: { userId: session.userId } },
      }),
    ]);
    const blocker = youtubePlaylistDeleteBlocker({ groupMemberships, sourceRules, destinationRules });
    if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });

    const result = await deleteYouTubePlaylistCli(input.playlistId);
    await removeCachedYouTubePlaylist(session.userId, input.playlistId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof BrowserLabRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete YouTube playlist" },
      { status: 500 },
    );
  }
}
