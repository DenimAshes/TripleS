import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncPlaylistTracksToDb } from "@/lib/services/playlistTracksStore";
import { serviceKey } from "@/lib/services/adapterFactory";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;

  const playlist = await prisma.playlist.findUnique({ where: { id } });
  if (!playlist || playlist.userId !== session.userId) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  try {
    const result = await syncPlaylistTracksToDb(
      session.userId,
      serviceKey(playlist.service),
      playlist.servicePlaylistId,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh playlist tracks" },
      { status: 502 },
    );
  }
}
