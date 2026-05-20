import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { parseArtistsJson } from "@/lib/utils/parseArtists";

const SERVICE_FROM_HOST: Array<[RegExp, string]> = [
  [/spotify\.com$/i, "SPOTIFY"],
  [/music\.youtube\.com$/i, "YOUTUBE"],
  [/(^|\.)youtube\.com$/i, "YOUTUBE"],
  [/youtu\.be$/i, "YOUTUBE"],
  [/soundcloud\.com$/i, "SOUNDCLOUD"],
];

function serviceFromUrl(url: string) {
  const parsed = new URL(url);
  return SERVICE_FROM_HOST.find(([pattern]) => pattern.test(parsed.hostname))?.[1] || null;
}

function trackIdFromUrl(url: string, service: string) {
  const parsed = new URL(url);
  if (service === "SPOTIFY") {
    const match = parsed.pathname.match(/\/track\/([^/?#]+)/);
    return match?.[1] || url;
  }
  if (service === "YOUTUBE") {
    return parsed.searchParams.get("v") || parsed.pathname.replace(/^\/+/, "") || url;
  }
  return parsed.pathname.replace(/^\/+|\/+$/g, "") || url;
}

export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await requireAuth(request);
  const { groupId } = await params;
  const body = await request.json().catch(() => ({}));
  const sourceTrackId = String(body.sourceTrackId || "");
  const rawUrl = String(body.url || "").trim();

  if (!sourceTrackId || !rawUrl) {
    return NextResponse.json({ error: "Song link is required." }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Paste a valid song link." }, { status: 400 });
  }

  const targetService = String(body.targetService || serviceFromUrl(url.toString()) || "");
  if (!targetService) {
    return NextResponse.json({ error: "This song link is from an unsupported platform." }, { status: 400 });
  }

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
  const serviceTrackId = trackIdFromUrl(url.toString(), targetService);
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
      url: url.toString(),
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
      url: url.toString(),
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
