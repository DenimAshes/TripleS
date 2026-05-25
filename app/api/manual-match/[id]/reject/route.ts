import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { scheduleManualMatchFollowupSync } from "@/lib/services/manualMatchResolution";

function trackMatchField(service: string) {
  if (service === "SPOTIFY") return "spotifyServiceTrackId";
  if (service === "YOUTUBE") return "youtubeServiceTrackId";
  return "soundcloudServiceTrackId";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;

  const existing = await prisma.manualMatchCandidate.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sourceTrack = await prisma.serviceTrack.findUnique({
    where: { id: existing.sourceServiceTrackId },
    select: { id: true, internalTrackId: true },
  });

  const destinationField = trackMatchField(existing.targetService);
  let deactivated = 0;

  await prisma.$transaction(async (tx) => {
    await tx.manualMatchCandidate.update({
      where: { id },
      data: { status: "REJECTED" },
    });

    if (sourceTrack) {
      const deleted = await tx.trackMatch.deleteMany({
        where: {
          internalTrackId: sourceTrack.internalTrackId,
          [destinationField]: existing.candidateServiceTrackId,
        },
      });
      deactivated = deleted.count;

      await tx.trackMatchNegativeCache.upsert({
        where: {
          internalTrackId_targetService: {
            internalTrackId: sourceTrack.internalTrackId,
            targetService: existing.targetService,
          },
        },
        update: { attemptedAt: new Date() },
        create: {
          internalTrackId: sourceTrack.internalTrackId,
          targetService: existing.targetService,
          attemptedAt: new Date(),
        },
      });
    }
  });

  const followup = await scheduleManualMatchFollowupSync({
    userId: session.userId,
    sourceServiceTrackId: existing.sourceServiceTrackId,
  });

  return NextResponse.json({ ok: true, deactivatedTrackMatches: deactivated, scheduledRules: followup.count });
}
