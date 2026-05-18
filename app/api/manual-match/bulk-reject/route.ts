import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

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
  const rawThreshold = typeof body?.threshold === "number" ? body.threshold : 0.65;
  const threshold = Math.max(0, Math.min(1, rawThreshold));
  const preview = body?.preview === true;

  const candidates = await prisma.manualMatchCandidate.findMany({
    where: { userId: session.userId, status: "PENDING", confidence: { lte: threshold } },
    orderBy: { confidence: "asc" },
  });

  if (preview) {
    return NextResponse.json({
      threshold,
      count: candidates.length,
      candidates: candidates.map((c) => ({
        id: c.id,
        confidence: c.confidence,
        sourceServiceTrackId: c.sourceServiceTrackId,
        candidateServiceTrackId: c.candidateServiceTrackId,
        targetService: c.targetService,
      })),
    });
  }

  let rejected = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const sourceTrack = await prisma.serviceTrack.findUnique({
        where: { id: candidate.sourceServiceTrackId },
        select: { id: true, internalTrackId: true },
      });
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
      rejected += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return NextResponse.json({ threshold, rejected, failed, errors: errors.slice(0, 5) });
}
