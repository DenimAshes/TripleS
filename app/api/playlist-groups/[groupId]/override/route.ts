import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { parseArtistsJson } from "@/lib/utils/parseArtists";
import { parseTrackUrl } from "@/lib/services/trackUrl";

export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await requireAuth(request);
  const { groupId } = await params;
  const body = await request.json().catch(() => ({}));
  const sourceTrackId = String(body.sourceTrackId || "");

  if (!sourceTrackId) {
    return NextResponse.json({ error: "Source song not found." }, { status: 400 });
  }

  let parsed: ReturnType<typeof parseTrackUrl>;
  try {
    parsed = parseTrackUrl(body.url, body.targetService ? String(body.targetService).toUpperCase() : undefined);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Paste a valid song link." }, { status: 400 });
  }

  const targetService = parsed.service;

  const member = await prisma.playlistGroupMember.findFirst({
    where: { groupId, service: targetService, group: { userId: session.userId } },
  });
  if (!member) {
    return NextResponse.json({ error: "Connect that platform first." }, { status: 404 });
  }

  const sourceTrack = await prisma.serviceTrack.findUnique({ where: { id: sourceTrackId } });
  if (!sourceTrack) {
    return NextResponse.json({ error: "Source song not found." }, { status: 404 });
  }

  const artists = parseArtistsJson(sourceTrack.artistsJson);
  const serviceTrackId = parsed.trackId;
  const internal = await prisma.internalTrack.upsert({
    where: { id: `${targetService}_${serviceTrackId}` },
    update: {},
    create: {
      id: `${targetService}_${serviceTrackId}`,
      canonicalTitle: sourceTrack.title,
      canonicalArtists: sourceTrack.artistsJson,
      canonicalAlbum: sourceTrack.album,
      durationMs: sourceTrack.durationMs,
      isrc: sourceTrack.isrc,
    },
  });
  const targetTrack = await prisma.serviceTrack.upsert({
    where: { service_serviceTrackId: { service: targetService, serviceTrackId } },
    update: {
      title: sourceTrack.title,
      artistsJson: JSON.stringify(artists),
      album: sourceTrack.album,
      durationMs: sourceTrack.durationMs,
      isrc: sourceTrack.isrc,
      url: parsed.url.toString(),
    },
    create: {
      internalTrackId: internal.id,
      service: targetService,
      serviceTrackId,
      title: sourceTrack.title,
      artistsJson: JSON.stringify(artists),
      album: sourceTrack.album,
      durationMs: sourceTrack.durationMs,
      isrc: sourceTrack.isrc,
      url: parsed.url.toString(),
    },
  });

  await prisma.trackOverride.upsert({
    where: {
      groupId_sourceTrackId_targetService: { groupId, sourceTrackId, targetService },
    },
    update: { targetTrackId: targetTrack.id },
    create: { groupId, sourceTrackId, targetService, targetTrackId: targetTrack.id },
  });

  return NextResponse.json({ targetTrack });
}
