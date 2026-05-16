import { prisma } from "@/lib/db/prisma";

// Marks SyncJob / BrowserJob rows that are stuck in RUNNING (or claimed)
// without progress as FAILED. The sync engine already does this on its own
// next entry, but that only kicks in when a fresh sync is started. After a
// crash/restart there can be a long window where the queue looks blocked
// because of phantom RUNNING rows. Run this from cron (or on supervisor
// startup) to clean them up independently.
//
// Usage:
//   npm run sweep:stale-jobs                 # dry run
//   npm run sweep:stale-jobs -- --apply      # actually mark FAILED
//   npm run sweep:stale-jobs -- --minutes=15 # change the staleness threshold

function parseFlags() {
  const apply = process.argv.includes("--apply");
  const minutesArg = process.argv.find((arg) => arg.startsWith("--minutes="));
  const minutes = minutesArg
    ? Number(minutesArg.slice("--minutes=".length))
    : Math.max(1, Number(process.env.WORKER_RUNNING_JOB_TIMEOUT_MINUTES ?? 60));
  if (!Number.isFinite(minutes) || minutes < 1) {
    throw new Error(`Invalid --minutes value: ${minutesArg}`);
  }
  return { apply, minutes };
}

async function main() {
  const { apply, minutes } = parseFlags();
  const cutoff = new Date(Date.now() - minutes * 60_000);
  console.log(`[sweep] mode=${apply ? "APPLY" : "DRY-RUN"} cutoff=${cutoff.toISOString()} (${minutes}min)`);

  const staleSyncJobs = await prisma.syncJob.findMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: cutoff },
      finishedAt: null,
    },
    select: { id: true, syncRuleId: true, startedAt: true },
  });
  const staleBrowserJobs = await prisma.browserJob.findMany({
    where: {
      status: { in: ["running", "queued"] },
      OR: [
        { claimedAt: { lt: cutoff } },
        { AND: [{ claimedAt: null }, { createdAt: { lt: cutoff } }] },
      ],
      finishedAt: null,
    },
    select: { id: true, type: true, status: true, claimedAt: true, createdAt: true },
  });

  console.log(`[sweep] SyncJob stale: ${staleSyncJobs.length}`);
  for (const job of staleSyncJobs) {
    console.log(`  - ${job.id} rule=${job.syncRuleId} startedAt=${job.startedAt.toISOString()}`);
  }
  console.log(`[sweep] BrowserJob stale: ${staleBrowserJobs.length}`);
  for (const job of staleBrowserJobs) {
    console.log(
      `  - ${job.id} type=${job.type} status=${job.status} claimedAt=${job.claimedAt?.toISOString() ?? "-"} createdAt=${job.createdAt.toISOString()}`,
    );
  }

  if (!apply) {
    if (staleSyncJobs.length || staleBrowserJobs.length) {
      console.log("\nRe-run with --apply to mark these as FAILED.");
    }
    return;
  }

  if (staleSyncJobs.length) {
    const result = await prisma.syncJob.updateMany({
      where: { id: { in: staleSyncJobs.map((row) => row.id) } },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: `Sweeper marked stale RUNNING job (no progress for ${minutes}+ minutes).`,
      },
    });
    console.log(`[sweep] SyncJob updated: ${result.count}`);
  }
  if (staleBrowserJobs.length) {
    const result = await prisma.browserJob.updateMany({
      where: { id: { in: staleBrowserJobs.map((row) => row.id) } },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorCode: "STALE",
        errorMessage: `Sweeper marked stale claim (no progress for ${minutes}+ minutes).`,
      },
    });
    console.log(`[sweep] BrowserJob updated: ${result.count}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
