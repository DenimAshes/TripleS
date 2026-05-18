import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { upsertAutoTrackMatch } from "@/lib/sync/trackMatchStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bulk-approve every PENDING ManualMatchCandidate whose stored top-candidate
// confidence is at or above the threshold. Same effect as clicking "Use this"
// on the first alternative of each card — no manual cherry-picking. Anything
// below the threshold is left alone for the user to review by hand.
//
// Body: { threshold: number (0..1, default 0.85), preview?: boolean }
// preview=true returns only the count + summaries; nothing is written.

type AlternativeEntry = { serviceTrackId: string; confidence: number };

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const rawThreshold = typeof body?.threshold === "number" ? body.threshold : 0.85;
  const threshold = Math.max(0, Math.min(1, rawThreshold));
  const preview = body?.preview === true;

  const candidates = await prisma.manualMatchCandidate.findMany({
    where: { userId: session.userId, status: "PENDING", confidence: { gte: threshold } },
    orderBy: { confidence: "desc" },
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

  let accepted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      // Use whatever the engine recorded as "candidate" — usually the
      // top-ranked alternative. Falls back to alternatives[0] if the
      // primary candidate row is gone.
      let targetTrackId = candidate.candidateServiceTrackId;
      const alternatives = candidate.alternativesJson
        ? (JSON.parse(candidate.alternativesJson) as AlternativeEntry[])
        : [];
      const primaryConfidence =
        alternatives.find((item) => item.serviceTrackId === targetTrackId)?.confidence ?? candidate.confidence;
      const [sourceTrack, candidateTrack] = await Promise.all([
        prisma.serviceTrack.findUnique({ where: { id: candidate.sourceServiceTrackId } }),
        prisma.serviceTrack.findUnique({ where: { id: targetTrackId } }),
      ]);
      if (!sourceTrack) {
        failed += 1;
        errors.push(`Source track missing for ${candidate.id}`);
        continue;
      }
      if (!candidateTrack) {
        // Try first alternative that still exists.
        const fallback = alternatives.find((a) => a.serviceTrackId !== targetTrackId);
        if (!fallback) {
          failed += 1;
          errors.push(`No target track for ${candidate.id}`);
          continue;
        }
        targetTrackId = fallback.serviceTrackId;
      }

      await upsertAutoTrackMatch({
        internalTrackId: sourceTrack.internalTrackId,
        sourceService: sourceTrack.service,
        destinationService: candidate.targetService,
        sourceServiceTrackId: sourceTrack.id,
        targetServiceTrackId: targetTrackId,
        confidence: primaryConfidence,
        status: "CONFIRMED",
      });
      await prisma.manualMatchCandidate.update({
        where: { id: candidate.id },
        data: { status: "ACCEPTED", candidateServiceTrackId: targetTrackId, confidence: primaryConfidence },
      });
      accepted += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return NextResponse.json({ threshold, accepted, failed, errors: errors.slice(0, 5) });
}
