import { prisma } from "@/lib/db/prisma";
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
// Candidates that no longer clear the manual-review floor are deleted rather
// than rejected: a PENDING row suppresses the search entirely
// (lib/sync/syncEngine.ts pendingReviewSourceTrackIds), so deleting is what
// lets the engine look for a better match, while REJECTED is sticky and would
// close the pair for good.
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
  const toUpdate: Array<{ id: string; from: number; to: number; text: string }> = [];
  const toDelete: Array<{ id: string; from: number; to: number; text: string }> = [];
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
      from: row.confidence,
      to: scored.score,
      text: `${label(source)}  =>  ${label(candidate)}`,
    };
    if (scored.score >= MANUAL_REVIEW_THRESHOLD) toUpdate.push(entry);
    else toDelete.push(entry);
  }

  if (orphans) console.log(`[requeue] skipped ${orphans} candidate(s) whose tracks are gone`);
  console.log(
    `[requeue] bands before: auto=${before.auto} review=${before.review} below=${before.below}` +
      `  ->  after: auto=${after.auto} review=${after.review} below=${after.below}`,
  );
  console.log(`[requeue] rescore ${toUpdate.length}, delete ${toDelete.length}`);

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

  let updated = 0;
  for (const item of toUpdate) {
    await prisma.manualMatchCandidate.update({ where: { id: item.id }, data: { confidence: item.to } });
    updated += 1;
  }
  console.log(`[requeue] rescored ${updated} candidate(s)`);

  if (toDelete.length) {
    const deleted = await prisma.manualMatchCandidate.deleteMany({
      where: { id: { in: toDelete.map((item) => item.id) } },
    });
    console.log(`[requeue] deleted ${deleted.count} candidate(s); the next sync will search for them again`);
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
