import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getCachedPlaylistTracks } from "@/lib/services/playlistTracksStore";
import { parseArtistsJson } from "@/lib/utils/parseArtists";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;

  const playlist = await prisma.playlist.findUnique({ where: { id } });
  if (!playlist || playlist.userId !== session.userId) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  const states = await getCachedPlaylistTracks(playlist.id);
  const tracks = states.map((state) => ({
    position: state.position,
    addedBySystem: state.addedBySystem,
    firstSeenAt: state.firstSeenAt,
    lastSeenAt: state.lastSeenAt,
    track: {
      id: state.serviceTrack.id,
      service: state.serviceTrack.service,
      serviceTrackId: state.serviceTrack.serviceTrackId,
      title: state.serviceTrack.title,
      artists: parseArtistsJson(state.serviceTrack.artistsJson),
      album: state.serviceTrack.album,
      durationMs: state.serviceTrack.durationMs,
      isrc: state.serviceTrack.isrc,
      url: state.serviceTrack.url,
      imageUrl: state.serviceTrack.imageUrl,
    },
  }));

  return NextResponse.json({ playlist, tracks });
}
