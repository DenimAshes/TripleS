import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { upsertAutoTrackMatch } from "@/lib/sync/trackMatchStore";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const existing = await prisma.manualMatchCandidate.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sourceTrack = await prisma.serviceTrack.findUnique({ where: { id: existing.sourceServiceTrackId } });
  const candidateTrack = await prisma.serviceTrack.findUnique({ where: { id: existing.candidateServiceTrackId } });
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
