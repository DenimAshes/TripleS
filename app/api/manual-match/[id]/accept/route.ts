import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { upsertAutoTrackMatch } from "@/lib/sync/trackMatchStore";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const existing = await prisma.manualMatchCandidate.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tracks = await prisma.serviceTrack.findMany({
    where: { id: { in: [existing.sourceServiceTrackId, existing.candidateServiceTrackId] } },
  });
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const sourceTrack = trackById.get(existing.sourceServiceTrackId);
  const candidateTrack = trackById.get(existing.candidateServiceTrackId);
  if (!sourceTrack || !candidateTrack) {
    return NextResponse.json({ error: "Candidate tracks not found" }, { status: 409 });
  }

  const match = await upsertAutoTrackMatch({
    internalTrackId: sourceTrack.internalTrackId,
    sourceService: sourceTrack.service,
    destinationService: existing.targetService,
    sourceServiceTrackId: sourceTrack.id,
    targetServiceTrackId: candidateTrack.id,
    confidence: existing.confidence,
    status: "CONFIRMED",
  });
  await prisma.manualMatchCandidate.update({
    where: { id },
    data: { status: "ACCEPTED" },
  });

  return NextResponse.json({ match });
}
