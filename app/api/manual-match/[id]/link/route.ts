import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { upsertAutoTrackMatch } from "@/lib/sync/trackMatchStore";
import { findCandidateGroup } from "@/lib/sync/manualMatchGroup";
import { parseTrackUrl } from "@/lib/services/trackUrl";
import { closeCompetingManualCandidates, scheduleManualMatchFollowupSync } from "@/lib/services/manualMatchResolution";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  const existing = await prisma.manualMatchCandidate.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let parsed: ReturnType<typeof parseTrackUrl>;
  try {
    parsed = parseTrackUrl(body.url, existing.targetService);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Paste a valid song link." }, { status: 400 });
  }

  const sourceTrack = await prisma.serviceTrack.findUnique({ where: { id: existing.sourceServiceTrackId } });
  if (!sourceTrack) return NextResponse.json({ error: "Source song not found." }, { status: 404 });

  const group = await findCandidateGroup({
    userId: session.userId,
    sourceServiceTrackId: existing.sourceServiceTrackId,
    targetService: existing.targetService,
  });
  if (!group) return NextResponse.json({ error: "Connected playlists not found." }, { status: 404 });

  const serviceTrackId = parsed.trackId;
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
      url: parsed.url.toString(),
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
      url: parsed.url.toString(),
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
  await closeCompetingManualCandidates({
    userId: session.userId,
    sourceServiceTrackId: existing.sourceServiceTrackId,
    targetService: existing.targetService,
    keepId: id,
  });
  const followup = await scheduleManualMatchFollowupSync({
    userId: session.userId,
    sourceServiceTrackId: existing.sourceServiceTrackId,
  });

  return NextResponse.json({ match, scheduledRules: followup.count });
}
