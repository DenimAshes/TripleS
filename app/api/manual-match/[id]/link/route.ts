import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { upsertAutoTrackMatch } from "@/lib/sync/trackMatchStore";
import { findCandidateGroup } from "@/lib/sync/manualMatchGroup";

function trackIdFromUrl(url: string, service: string) {
  const parsed = new URL(url);
  if (service === "SPOTIFY") {
    return parsed.pathname.match(/\/track\/([^/?#]+)/)?.[1] || url;
  }
  if (service === "YOUTUBE") {
    return parsed.searchParams.get("v") || parsed.pathname.replace(/^\/+/, "") || url;
  }
  return parsed.pathname.replace(/^\/+|\/+$/g, "") || url;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const rawUrl = String(body.url || "").trim();
  if (!rawUrl) return NextResponse.json({ error: "Song link is required." }, { status: 400 });

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Paste a valid song link." }, { status: 400 });
  }

  const existing = await prisma.manualMatchCandidate.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sourceTrack = await prisma.serviceTrack.findUnique({ where: { id: existing.sourceServiceTrackId } });
  if (!sourceTrack) return NextResponse.json({ error: "Source song not found." }, { status: 404 });

  const group = await findCandidateGroup({
    userId: session.userId,
    sourceServiceTrackId: existing.sourceServiceTrackId,
    targetService: existing.targetService,
  });
  if (!group) return NextResponse.json({ error: "Connected playlists not found." }, { status: 404 });

  const serviceTrackId = trackIdFromUrl(url.toString(), existing.targetService);
  const internal = await prisma.internalTrack.upsert({
    where: { id: `${existing.targetService}_${serviceTrackId}` },
    update: {},
    create: {
      id: `${existing.targetService}_${serviceTrackId}`,
      canonicalTitle: sourceTrack.title,
      canonicalArtists: sourceTrack.artistsJson,
      canonicalAlbum: sourceTrack.album,
      durationMs: sourceTrack.durationMs,
      isrc: sourceTrack.isrc,
    },
  });
  const targetTrack = await prisma.serviceTrack.upsert({
    where: { service_serviceTrackId: { service: existing.targetService, serviceTrackId } },
    update: {
      title: sourceTrack.title,
      artistsJson: sourceTrack.artistsJson,
      album: sourceTrack.album,
      durationMs: sourceTrack.durationMs,
      isrc: sourceTrack.isrc,
      url: url.toString(),
    },
    create: {
      internalTrackId: internal.id,
      service: existing.targetService,
      serviceTrackId,
      title: sourceTrack.title,
      artistsJson: sourceTrack.artistsJson,
      album: sourceTrack.album,
      durationMs: sourceTrack.durationMs,
      isrc: sourceTrack.isrc,
      url: url.toString(),
    },
  });

  await prisma.trackOverride.upsert({
    where: {
      groupId_sourceTrackId_targetService: {
        groupId: group.id,
        sourceTrackId: sourceTrack.id,
        targetService: existing.targetService,
      },
    },
    update: { targetTrackId: targetTrack.id },
    create: {
      groupId: group.id,
      sourceTrackId: sourceTrack.id,
      targetService: existing.targetService,
      targetTrackId: targetTrack.id,
    },
  });
  const match = await upsertAutoTrackMatch({
    internalTrackId: sourceTrack.internalTrackId,
    sourceService: sourceTrack.service,
    destinationService: existing.targetService,
    sourceServiceTrackId: sourceTrack.id,
    targetServiceTrackId: targetTrack.id,
    confidence: 1,
    status: "CONFIRMED",
  });
  await prisma.manualMatchCandidate.update({
    where: { id },
    data: { status: "ACCEPTED", candidateServiceTrackId: targetTrack.id, confidence: 1 },
  });

  return NextResponse.json({ match });
}
