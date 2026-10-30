import { prisma } from "@/lib/db/prisma";
import {
  ACCIDENTAL_SMOKE_CONFIRMATION,
  ACCIDENTAL_SMOKE_WINDOWS,
  accidentalSmokeCleanupMismatches,
  type AccidentalSmokeCleanupCounts,
} from "@/lib/sync/accidentalSmokeCleanup";

// Removes only the manual-match decisions made by the unsafe 2026-08-19
// ui:smoke runs. Default mode is read-only; apply is count-guarded and atomic.

const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes(`--confirm=${ACCIDENTAL_SMOKE_CONFIRMATION}`);
const windows = ACCIDENTAL_SMOKE_WINDOWS.map(({ start, end }) => ({
  gte: new Date(start),
  lt: new Date(end),
}));
const preservedWindow = {
  gte: new Date("2026-08-19T17:00:00.000Z"),
  lt: new Date("2026-08-19T17:30:00.000Z"),
};

async function main() {
  const [trackMatches, negativeCaches, candidates, preservedMatches, preservedCandidates] = await Promise.all([
    prisma.trackMatch.findMany({
      where: { OR: windows.map((createdAt) => ({ createdAt })) },
      select: { id: true, createdAt: true },
    }),
    prisma.trackMatchNegativeCache.findMany({
      where: { OR: windows.map((attemptedAt) => ({ attemptedAt })) },
      select: { id: true, attemptedAt: true },
    }),
    prisma.manualMatchCandidate.findMany({
      where: {
        OR: windows.map((updatedAt) => ({ updatedAt })),
        status: { in: ["ACCEPTED", "REJECTED"] },
      },
      select: { id: true, status: true, updatedAt: true },
    }),
    prisma.trackMatch.count({ where: { createdAt: preservedWindow } }),
    prisma.manualMatchCandidate.findMany({
      where: { updatedAt: preservedWindow, status: { in: ["ACCEPTED", "REJECTED"] } },
      select: { status: true },
    }),
  ]);

  const counts: AccidentalSmokeCleanupCounts = {
    trackMatches: trackMatches.length,
    negativeCaches: negativeCaches.length,
    acceptedCandidates: candidates.filter((candidate) => candidate.status === "ACCEPTED").length,
    rejectedCandidates: candidates.filter((candidate) => candidate.status === "REJECTED").length,
  };
  const mismatches = accidentalSmokeCleanupMismatches(counts);

  console.log(`[cleanup-smoke-decisions] mode=${apply ? "APPLY" : "DRY-RUN"}`);
  for (const [index, window] of ACCIDENTAL_SMOKE_WINDOWS.entries()) {
    const inWindow = (date: Date) => date >= new Date(window.start) && date < new Date(window.end);
    console.log(
      `[cleanup-smoke-decisions] ${window.start}..<${window.end}: ` +
        `matches=${trackMatches.filter((row) => inWindow(row.createdAt)).length}, ` +
        `negative=${negativeCaches.filter((row) => inWindow(row.attemptedAt)).length}, ` +
        `candidates=${candidates.filter((row) => inWindow(row.updatedAt)).length}`,
    );
    if (index === 0) console.log("[cleanup-smoke-decisions] preserving all rows before 17:30Z");
  }
  console.log(
    `[cleanup-smoke-decisions] candidates: accepted=${counts.acceptedCandidates}, rejected=${counts.rejectedCandidates}`,
  );
  console.log(
    `[cleanup-smoke-decisions] preserved 17:00Z..<17:30Z: matches=${preservedMatches}, ` +
      `accepted=${preservedCandidates.filter((candidate) => candidate.status === "ACCEPTED").length}, ` +
      `rejected=${preservedCandidates.filter((candidate) => candidate.status === "REJECTED").length}`,
  );

  if (mismatches.length) {
    console.warn(`[cleanup-smoke-decisions] safety check failed:\n- ${mismatches.join("\n- ")}`);
  }
  if (!apply) {
    console.log("[cleanup-smoke-decisions] dry run: nothing written.");
    console.log(
      `[cleanup-smoke-decisions] apply with: npm run match:cleanup-smoke -- --apply --confirm=${ACCIDENTAL_SMOKE_CONFIRMATION}`,
    );
    return;
  }
  if (!confirmed) {
    throw new Error(`Refusing to write without --confirm=${ACCIDENTAL_SMOKE_CONFIRMATION}`);
  }
  if (mismatches.length) {
    throw new Error("Refusing to write because the database no longer matches the recorded smoke-test artifacts.");
  }

  await prisma.$transaction(async (tx) => {
    const reset = await tx.manualMatchCandidate.updateMany({
      where: { id: { in: candidates.map((candidate) => candidate.id) } },
      data: { status: "PENDING" },
    });
    const deletedMatches = await tx.trackMatch.deleteMany({
      where: { id: { in: trackMatches.map((match) => match.id) } },
    });
    const deletedCaches = await tx.trackMatchNegativeCache.deleteMany({
      where: { id: { in: negativeCaches.map((cache) => cache.id) } },
    });

    if (
      reset.count !== candidates.length ||
      deletedMatches.count !== trackMatches.length ||
      deletedCaches.count !== negativeCaches.length
    ) {
      throw new Error("Cleanup counts changed during the transaction; rolled back.");
    }
  });

  console.log(
    `[cleanup-smoke-decisions] reset ${candidates.length} candidates; deleted ${trackMatches.length} matches and ${negativeCaches.length} negative-cache rows.`,
  );
  console.log("[cleanup-smoke-decisions] next: npm run match:requeue -- --apply");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
