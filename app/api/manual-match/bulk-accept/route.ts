import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { upsertAutoTrackMatch } from "@/lib/sync/trackMatchStore";
import {
  buildManualMatchPreviewCandidates,
  ManualMatchRequestError,
  parseBulkThreshold,
  parseManualMatchAlternatives,
  parsePreviewFlag,
} from "@/lib/services/manualMatchRequest";
import { closeCompetingManualCandidates, scheduleManualMatchFollowupSyncs } from "@/lib/services/manualMatchResolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bulk-approve every PENDING ManualMatchCandidate whose stored top-candidate
// confidence is at or above the threshold. Same effect as clicking "Use this"
// on the first alternative of each card — no manual cherry-picking. Anything
// below the threshold is left alone for the user to review by hand.
//
// Body: { threshold: number (0..1, default 0.85), preview?: boolean }
// preview=true returns only the count + summaries; nothing is written.

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  let threshold: number;
  try {
    threshold = parseBulkThreshold(body?.threshold, 0.85);
  } catch (error) {
    if (error instanceof ManualMatchRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const preview = parsePreviewFlag(body?.preview);

  const candidates = await prisma.manualMatchCandidate.findMany({
    where: { userId: session.userId, status: "PENDING", confidence: { gte: threshold } },
    orderBy: { confidence: "desc" },
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

  let accepted = 0;
  let failed = 0;
  const errors: string[] = [];
  const acceptedSourceTrackIds: string[] = [];

  const alternativesByCandidate = new Map(candidates.map((c) => [c.id, parseManualMatchAlternatives(c.alternativesJson)]));
  const allTrackIds = new Set<string>();
  for (const c of candidates) {
    allTrackIds.add(c.sourceServiceTrackId);
    allTrackIds.add(c.candidateServiceTrackId);
    for (const alt of alternativesByCandidate.get(c.id) ?? []) {
      allTrackIds.add(alt.serviceTrackId);
    }
  }
  const fetchedTracks = allTrackIds.size
    ? await prisma.serviceTrack.findMany({ where: { id: { in: Array.from(allTrackIds) } } })
    : [];
  const trackById = new Map(fetchedTracks.map((track) => [track.id, track]));

  for (const candidate of candidates) {
    try {
      // Use whatever the engine recorded as "candidate" — usually the
      // top-ranked alternative. Falls back to alternatives[0] if the
      // primary candidate row is gone.
      let targetTrackId = candidate.candidateServiceTrackId;
      const alternatives = alternativesByCandidate.get(candidate.id) ?? [];
      const primaryConfidence =
        alternatives.find((item) => item.serviceTrackId === targetTrackId)?.confidence ?? candidate.confidence;
      const sourceTrack = trackById.get(candidate.sourceServiceTrackId);
      const candidateTrack = trackById.get(targetTrackId);
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
      await closeCompetingManualCandidates({
        userId: session.userId,
        sourceServiceTrackId: candidate.sourceServiceTrackId,
        targetService: candidate.targetService,
        keepId: candidate.id,
      });
      acceptedSourceTrackIds.push(candidate.sourceServiceTrackId);
      accepted += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const followup = await scheduleManualMatchFollowupSyncs({
    userId: session.userId,
    sourceServiceTrackIds: acceptedSourceTrackIds,
  });

  return NextResponse.json({ threshold, accepted, failed, scheduledRules: followup.count, errors: errors.slice(0, 5) });
}
