import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import {
  buildManualMatchPreviewCandidates,
  ManualMatchRequestError,
  parseBulkThreshold,
  parsePreviewFlag,
} from "@/lib/services/manualMatchRequest";
import { scheduleManualMatchFollowupSyncs } from "@/lib/services/manualMatchResolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bulk-reject every PENDING ManualMatchCandidate whose stored top-candidate
// confidence is at or below the threshold. Same effect as clicking "Skip"
// on each card — flips the row to REJECTED, drops any matching TrackMatch
// that points at this candidate, and stamps a negative-cache entry so the
// engine won't re-suggest the same target on the next run.
//
// Body: { threshold: number (0..1, default 0.65), preview?: boolean }
// preview=true returns only the count + summaries; nothing is written.

function trackMatchField(service: string): "spotifyServiceTrackId" | "youtubeServiceTrackId" | "soundcloudServiceTrackId" {
  if (service === "SPOTIFY") return "spotifyServiceTrackId";
  if (service === "YOUTUBE") return "youtubeServiceTrackId";
  return "soundcloudServiceTrackId";
}

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  let threshold: number;
  try {
    threshold = parseBulkThreshold(body?.threshold, 0.65);
  } catch (error) {
    if (error instanceof ManualMatchRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const preview = parsePreviewFlag(body?.preview);

  const candidates = await prisma.manualMatchCandidate.findMany({
    where: { userId: session.userId, status: "PENDING", confidence: { lte: threshold } },
    orderBy: { confidence: "asc" },
  });

  if (preview) {
    const previewCandidates = candidates.slice(0, 8);
    const trackIds = Array.from(new Set(previewCandidates.flatMap((c) => [c.sourceServiceTrackId, c.candidateServiceTrackId])));
    const tracks = trackIds.length
      ? await prisma.serviceTrack.findMany({
          where: { id: { in: trackIds } },
          select: { id: true, service: true, title: true, artistsJson: true },
        })
      : [];
    const trackById = new Map(tracks.map((track) => [track.id, track]));

    return NextResponse.json({
      threshold,
      count: candidates.length,
      remaining: Math.max(0, candidates.length - previewCandidates.length),
      candidates: buildManualMatchPreviewCandidates(previewCandidates, trackById),
    });
  }

  let rejected = 0;
  let failed = 0;
  const errors: string[] = [];
  const rejectedSourceTrackIds: string[] = [];

  const sourceTrackIds = Array.from(new Set(candidates.map((c) => c.sourceServiceTrackId)));
  const sourceTracks = sourceTrackIds.length
    ? await prisma.serviceTrack.findMany({
        where: { id: { in: sourceTrackIds } },
        select: { id: true, internalTrackId: true },
      })
    : [];
  const sourceTrackById = new Map(sourceTracks.map((track) => [track.id, track]));

  for (const candidate of candidates) {
    try {
      const sourceTrack = sourceTrackById.get(candidate.sourceServiceTrackId);
      const destinationField = trackMatchField(candidate.targetService);

      await prisma.$transaction(async (tx) => {
        await tx.manualMatchCandidate.update({
          where: { id: candidate.id },
          data: { status: "REJECTED" },
        });
        if (sourceTrack) {
          await tx.trackMatch.deleteMany({
            where: {
              internalTrackId: sourceTrack.internalTrackId,
              [destinationField]: candidate.candidateServiceTrackId,
            },
          });
          await tx.trackMatchNegativeCache.upsert({
            where: {
              internalTrackId_targetService: {
                internalTrackId: sourceTrack.internalTrackId,
                targetService: candidate.targetService,
              },
            },
            update: { attemptedAt: new Date() },
            create: {
              internalTrackId: sourceTrack.internalTrackId,
              targetService: candidate.targetService,
              attemptedAt: new Date(),
            },
          });
        }
      });
      rejectedSourceTrackIds.push(candidate.sourceServiceTrackId);
      rejected += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const followup = await scheduleManualMatchFollowupSyncs({
    userId: session.userId,
    sourceServiceTrackIds: rejectedSourceTrackIds,
  });

  return NextResponse.json({ threshold, rejected, failed, scheduledRules: followup.count, errors: errors.slice(0, 5) });
}
