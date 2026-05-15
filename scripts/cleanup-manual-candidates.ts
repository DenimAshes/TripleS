import { prisma } from "@/lib/db/prisma";

type Mode = "report" | "delete";

function parseMode(): Mode {
  return process.argv.includes("--delete") ? "delete" : "report";
}

function optionNumber(name: string, fallback: number): number {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const mode = parseMode();
  const olderThanDays = optionNumber("--older-than", 0);
  const orphanOnly = process.argv.includes("--orphan");
  const restrictUserId = process.argv.find((arg) => arg.startsWith("--user="))?.slice("--user=".length) || null;

  const where: Record<string, unknown> = { status: "PENDING" };
  if (olderThanDays > 0) {
    where.createdAt = { lt: new Date(Date.now() - olderThanDays * 24 * 3600_000) };
  }
  if (restrictUserId) {
    where.userId = restrictUserId;
  }

  const pending = await prisma.manualMatchCandidate.findMany({
    where,
    select: {
      id: true,
      userId: true,
      sourceServiceTrackId: true,
      targetService: true,
      createdAt: true,
    },
  });

  if (!pending.length) {
    console.log("[cleanup-manual-candidates] no PENDING candidates match filters.");
    return;
  }

  const sourceTrackIds = Array.from(new Set(pending.map((row) => row.sourceServiceTrackId)));
  const liveStates = await prisma.playlistTrackState.findMany({
    where: { serviceTrackId: { in: sourceTrackIds }, removedAt: null },
    select: { serviceTrackId: true },
  });
  const liveTrackIds = new Set(liveStates.map((state) => state.serviceTrackId));

  const targets = pending.filter((row) => {
    if (!orphanOnly) return true;
    return !liveTrackIds.has(row.sourceServiceTrackId);
  });

  if (!targets.length) {
    console.log("[cleanup-manual-candidates] nothing to clean (no orphan PENDING candidates).");
    return;
  }

  const byTargetService = targets.reduce<Record<string, number>>((acc, row) => {
    acc[row.targetService] = (acc[row.targetService] || 0) + 1;
    return acc;
  }, {});
  const orphanCount = targets.filter((row) => !liveTrackIds.has(row.sourceServiceTrackId)).length;
  const ageDays = targets.map((row) => (Date.now() - row.createdAt.getTime()) / (24 * 3600_000));
  const oldest = ageDays.length ? Math.max(...ageDays) : 0;
  const newest = ageDays.length ? Math.min(...ageDays) : 0;

  console.log(
    `[cleanup-manual-candidates] match=${targets.length} orphan=${orphanCount} ageDays=[min=${newest.toFixed(1)},max=${oldest.toFixed(1)}] byTargetService=${JSON.stringify(byTargetService)}`,
  );

  if (mode === "delete") {
    const ids = targets.map((row) => row.id);
    const chunkSize = 500;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const slice = ids.slice(i, i + chunkSize);
      const result = await prisma.manualMatchCandidate.deleteMany({ where: { id: { in: slice } } });
      deleted += result.count;
    }
    console.log(`[cleanup-manual-candidates] deleted ${deleted} candidates.`);
  } else {
    console.log("[cleanup-manual-candidates] dry-run only. Re-run with --delete to remove.");
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
