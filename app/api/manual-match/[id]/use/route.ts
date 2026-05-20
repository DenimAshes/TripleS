import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { upsertAutoTrackMatch } from "@/lib/sync/trackMatchStore";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const serviceTrackId = typeof body.serviceTrackId === "string" ? body.serviceTrackId : null;
  if (!serviceTrackId) return NextResponse.json({ error: "Song is required" }, { status: 400 });

  const existing = await prisma.manualMatchCandidate.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tracks = await prisma.serviceTrack.findMany({
    where: { id: { in: [existing.sourceServiceTrackId, serviceTrackId] } },
  });
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const sourceTrack = trackById.get(existing.sourceServiceTrackId);
  const candidateTrack = trackById.get(serviceTrackId);
  if (!sourceTrack || !candidateTrack) {
    return NextResponse.json({ error: "Song not found" }, { status: 409 });
  }

  const alternatives = existing.alternativesJson
    ? (JSON.parse(existing.alternativesJson) as Array<{ serviceTrackId: string; confidence: number }>)
    : [];
  const confidence = alternatives.find((item) => item.serviceTrackId === serviceTrackId)?.confidence ?? existing.confidence;

  const match = await upsertAutoTrackMatch({
    internalTrackId: sourceTrack.internalTrackId,
    sourceService: sourceTrack.service,
    destinationService: existing.targetService,
    sourceServiceTrackId: sourceTrack.id,
    targetServiceTrackId: candidateTrack.id,
    confidence,
    status: "CONFIRMED",
  });

  await prisma.manualMatchCandidate.update({
    where: { id },
    data: { status: "ACCEPTED", candidateServiceTrackId: serviceTrackId, confidence },
  });

  return NextResponse.json({ match });
}
