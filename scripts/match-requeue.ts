import { prisma } from "@/lib/db/prisma";
import { scheduleManualMatchFollowupSyncs } from "@/lib/services/manualMatchResolution";
import { AUTO_MATCH_THRESHOLD, MANUAL_REVIEW_THRESHOLD } from "@/lib/sync/matchThresholds";
import { normalizedFromServiceTrack } from "@/lib/sync/serviceTrackToNormalized";
import { parseArtistsJson } from "@/lib/utils/parseArtists";
import { calculateSimilarityWithBreakdown } from "@/lib/utils/similarity";

// Re-scores the /manual-match queue with the current matcher and repairs the
// SoundCloud durations that poisoned it.
//
// Two problems this fixes:
//   1. api-v2 reports label-owned tracks as a 30-second snippet, and that value
//      was stored as the track length. The matcher's duration penalty then
//      buried pairs whose title and artist matched exactly. Clearing the bogus
//      value lets those pairs score again; the next destination read refills it
//      with the real length now that the runner prefers `full_duration`.
//   2. Candidate confidence was ratcheted with Math.max across every scorer
//      version a pair ever passed through, so the queue sorted and offered
//      bulk-accept on numbers no current code would produce.
//
// Candidates that now clear the automatic threshold, or no longer clear the
// manual-review floor, are deleted rather than accepted/rejected: a PENDING row suppresses the search entirely
// (lib/sync/syncEngine.ts pendingReviewSourceTrackIds), so deleting is what
// lets the engine run the current matcher again. Automatic decisions therefore
// do not masquerade as human labels in calibration data, while REJECTED remains
// reserved for a real user decision.
//
// Default mode: report only. Pass --apply to write.

const SNIPPET_DURATION_MS = 30_000;

function parseFlags() {
  return { apply: process.argv.includes("--apply") };
}

function band(score: number) {
  if (score >= AUTO_MATCH_THRESHOLD) return "auto";
  if (score >= MANUAL_REVIEW_THRESHOLD) return "review";
  return "below";
}

function label(track: { title: string; artistsJson: string }) {
  const artists = parseArtistsJson(track.artistsJson).join(", ");
  return artists ? `${track.title} — ${artists}` : track.title;
}

function candidateGroup(row: { userId: string; sourceServiceTrackId: string; targetService: string }) {
  return `${row.userId}:${row.sourceServiceTrackId}:${row.targetService}`;
}

async function main() {
  const { apply } = parseFlags();
  console.log(
    `[requeue] mode=${apply ? "APPLY" : "DRY-RUN"} auto=${AUTO_MATCH_THRESHOLD} review=${MANUAL_REVIEW_THRESHOLD}`,
  );

  const snippetTracks = await prisma.serviceTrack.findMany({
    where: { service: "SOUNDCLOUD", durationMs: SNIPPET_DURATION_MS },
    select: { id: true },
  });
  const snippetIds = new Set(snippetTracks.map((track) => track.id));
  console.log(`[requeue] SoundCloud tracks stored at exactly ${SNIPPET_DURATION_MS}ms: ${snippetIds.size}`);

  const candidates = await prisma.manualMatchCandidate.findMany({
    where: { status: "PENDING" },
    orderBy: { confidence: "desc" },
  });
  console.log(`[requeue] pending candidates: ${candidates.length}`);
  if (!candidates.length && !snippetIds.size) return;

  const trackIds = Array.from(
    new Set(candidates.flatMap((row) => [row.sourceServiceTrackId, row.candidateServiceTrackId])),
  );
  const tracks = await prisma.serviceTrack.findMany({ where: { id: { in: trackIds } } });
  const trackById = new Map(tracks.map((track) => [track.id, track]));

  const before: Record<string, number> = { auto: 0, review: 0, below: 0 };
  const after: Record<string, number> = { auto: 0, review: 0, below: 0 };
  type Entry = {
    id: string;
    userId: string;
    sourceServiceTrackId: string;
    targetService: string;
    from: number;
    to: number;
    text: string;
  };
  const rescored: Entry[] = [];
  let orphans = 0;

  for (const row of candidates) {
    const source = trackById.get(row.sourceServiceTrackId);
    const candidate = trackById.get(row.candidateServiceTrackId);
    if (!source || !candidate) {
      orphans += 1;
      continue;
    }
    before[band(row.confidence)] += 1;

    // Score against the repaired data so a dry run predicts what --apply gives.
    const scored = calculateSimilarityWithBreakdown(
      normalizedFromServiceTrack(snippetIds.has(source.id) ? { ...source, durationMs: null } : source),
      normalizedFromServiceTrack(snippetIds.has(candidate.id) ? { ...candidate, durationMs: null } : candidate),
    );
    after[band(scored.score)] += 1;

    const entry = {
      id: row.id,
      userId: row.userId,
      sourceServiceTrackId: row.sourceServiceTrackId,
      targetService: row.targetService,
      from: row.confidence,
      to: scored.score,
      text: `${label(source)}  =>  ${label(candidate)}`,
    };
    rescored.push(entry);
  }

  // One source can retain an older competing candidate from a previous run.
  // Once any candidate in that decision is automatic, release the whole group
  // so the normal matcher can select today's best result once.
  const automaticGroups = new Set(
    rescored.filter((item) => item.to >= AUTO_MATCH_THRESHOLD).map(candidateGroup),
  );
  const toRelease = rescored.filter((item) => automaticGroups.has(candidateGroup(item)));
  const toUpdate = rescored.filter(
    (item) => !automaticGroups.has(candidateGroup(item)) && item.to >= MANUAL_REVIEW_THRESHOLD,
  );
  const toDelete = rescored.filter(
    (item) => !automaticGroups.has(candidateGroup(item)) && item.to < MANUAL_REVIEW_THRESHOLD,
  );

  if (orphans) console.log(`[requeue] skipped ${orphans} candidate(s) whose tracks are gone`);
  console.log(
    `[requeue] bands before: auto=${before.auto} review=${before.review} below=${before.below}` +
      `  ->  after: auto=${after.auto} review=${after.review} below=${after.below}`,
  );
  console.log(
    `[requeue] release ${toRelease.length} stale review row(s) across ${automaticGroups.size} automatic decision(s),` +
      ` rescore ${toUpdate.length}, delete ${toDelete.length}`,
  );

  console.log("\n[requeue] to release back to automatic matching:");
  for (const item of toRelease.sort((a, b) => b.to - a.to)) {
    console.log(`  ${item.from.toFixed(3)} -> ${item.to.toFixed(3)}  ${item.text}`);
  }

  console.log("\n[requeue] to delete (below the review floor with today's scorer):");
  for (const item of toDelete.sort((a, b) => b.to - a.to)) {
    console.log(`  ${item.from.toFixed(3)} -> ${item.to.toFixed(3)}  ${item.text}`);
  }

  const moved = toUpdate.filter((item) => Math.abs(item.to - item.from) >= 0.005);
  console.log(`\n[requeue] confidence changes on kept candidates (${moved.length}):`);
  for (const item of moved.sort((a, b) => b.to - a.to)) {
    console.log(`  ${item.from.toFixed(3)} -> ${item.to.toFixed(3)}  ${item.text}`);
  }

  if (!apply) {
    console.log("\n[requeue] dry run: nothing written. Re-run with --apply.");
    return;
  }

  if (snippetIds.size) {
    const cleared = await prisma.serviceTrack.updateMany({
      where: { service: "SOUNDCLOUD", durationMs: SNIPPET_DURATION_MS },
      data: { durationMs: null },
    });
    console.log(`\n[requeue] cleared snippet duration on ${cleared.count} SoundCloud track(s)`);
  }

  if (toRelease.length) {
    const released = await prisma.manualMatchCandidate.deleteMany({
      where: { id: { in: toRelease.map((item) => item.id) }, status: "PENDING" },
    });
    console.log(`\n[requeue] released ${released.count} stale review row(s) back to automatic matching`);
  }

  let updated = 0;
  for (const item of toUpdate) {
    await prisma.manualMatchCandidate.update({ where: { id: item.id }, data: { confidence: item.to } });
    updated += 1;
  }
  console.log(`[requeue] rescored ${updated} candidate(s)`);

  if (toDelete.length) {
    const deleted = await prisma.manualMatchCandidate.deleteMany({
      where: { id: { in: toDelete.map((item) => item.id) }, status: "PENDING" },
    });
    console.log(`[requeue] deleted ${deleted.count} candidate(s); the next sync will search for them again`);
  }

  const followupByUser = new Map<string, Set<string>>();
  for (const item of [...toRelease, ...toDelete]) {
    const sourceIds = followupByUser.get(item.userId) ?? new Set<string>();
    sourceIds.add(item.sourceServiceTrackId);
    followupByUser.set(item.userId, sourceIds);
  }
  for (const [userId, sourceIds] of followupByUser) {
    const queued = await scheduleManualMatchFollowupSyncs({
      userId,
      sourceServiceTrackIds: Array.from(sourceIds),
    });
    console.log(`[requeue] queued ${queued.count} follow-up sync rule(s)`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
