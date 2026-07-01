import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { findCandidateGroup } from "@/lib/sync/manualMatchGroup";
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
  if (existing.status === "PENDING") {
    return NextResponse.json({ error: "This song is already waiting for review." }, { status: 409 });
  }

  const sourceTrack = await prisma.serviceTrack.findUnique({
    where: { id: existing.sourceServiceTrackId },
    select: { id: true, internalTrackId: true },
  });
  if (!sourceTrack) return NextResponse.json({ error: "Source song not found" }, { status: 409 });

  const group = existing.status === "REJECTED"
    ? await findCandidateGroup({
        userId: session.userId,
        sourceServiceTrackId: existing.sourceServiceTrackId,
        targetService: existing.targetService,
      })
    : null;

  const destinationField = trackMatchField(existing.targetService);
  let deletedTrackMatches = 0;
  let deletedNegativeCaches = 0;
  let deletedExclusions = 0;

  await prisma.$transaction(async (tx) => {
    await tx.manualMatchCandidate.update({
      where: { id },
      data: { status: "PENDING" },
    });

    if (existing.status === "ACCEPTED") {
      const deleted = await tx.trackMatch.deleteMany({
        where: {
          internalTrackId: sourceTrack.internalTrackId,
          [destinationField]: existing.candidateServiceTrackId,
          status: "CONFIRMED",
        },
      });
      deletedTrackMatches = deleted.count;
    }

    if (existing.status === "REJECTED") {
      const deletedCache = await tx.trackMatchNegativeCache.deleteMany({
        where: {
          internalTrackId: sourceTrack.internalTrackId,
          targetService: existing.targetService,
        },
      });
      deletedNegativeCaches = deletedCache.count;

      if (group) {
        const deletedExclusion = await tx.syncTrackExclusion.deleteMany({
          where: {
            groupId: group.id,
            sourceTrackId: existing.sourceServiceTrackId,
            targetService: existing.targetService,
            reason: "USER_CHOICE",
          },
        });
        deletedExclusions = deletedExclusion.count;
      }
    }
  });

  const followup = await scheduleManualMatchFollowupSync({
    userId: session.userId,
    sourceServiceTrackId: existing.sourceServiceTrackId,
  });

  return NextResponse.json({
    ok: true,
    scheduledRules: followup.count,
    restoredStatus: "PENDING",
    deletedTrackMatches,
    deletedNegativeCaches,
    deletedExclusions,
  });
}
