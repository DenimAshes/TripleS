import os from "node:os";
import { prisma } from "@/lib/db/prisma";
import {
  claimQueuedBrowserActionJob,
  reclaimStaleBrowserActionJobs,
  runClaimedBrowserActionJob,
} from "@/lib/services/browserActionJobs";

const POLL_INTERVAL_MS = Math.max(250, Number(process.env.BROWSER_JOB_POLL_INTERVAL_MS ?? 1500));
const STALE_AFTER_MS = Math.max(60_000, Number(process.env.BROWSER_JOB_STALE_AFTER_MS ?? 30 * 60_000));
const RECLAIM_INTERVAL_MS = Math.max(POLL_INTERVAL_MS, Number(process.env.BROWSER_JOB_RECLAIM_INTERVAL_MS ?? 60_000));
const RUN_ONCE = process.argv.includes("--once") || process.env.BROWSER_JOB_WORKER_ONCE === "true";
const IDLE_EXIT_MS = Math.max(0, Number(process.env.BROWSER_JOB_WORKER_IDLE_EXIT_MS ?? 0));
const WORKER_ID = process.env.BROWSER_JOB_WORKER_ID || `${os.hostname()}-${process.pid}`;

let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[browser-job-worker] ${signal} received, draining current job`);
}

process.on("SIGINT", () => requestShutdown("SIGINT"));
process.on("SIGTERM", () => requestShutdown("SIGTERM"));

async function main(): Promise<void> {
  console.log(
    `[browser-job-worker] starting (workerId=${WORKER_ID}, pollIntervalMs=${POLL_INTERVAL_MS}, staleAfterMs=${STALE_AFTER_MS}, once=${RUN_ONCE}, idleExitMs=${IDLE_EXIT_MS})`,
  );
  let processed = 0;
  let lastWorkAt = Date.now();
  let lastReclaimAt = 0;

  while (!shuttingDown) {
    if (Date.now() - lastReclaimAt >= RECLAIM_INTERVAL_MS) {
      lastReclaimAt = Date.now();
      const reclaimed = await reclaimStaleBrowserActionJobs(STALE_AFTER_MS);
      if (reclaimed > 0) {
        console.warn(`[browser-job-worker] reclaimed ${reclaimed} stale running job(s)`);
      }
    }

    const job = await claimQueuedBrowserActionJob(WORKER_ID);
    if (!job) {
      if (RUN_ONCE) break;
      if (IDLE_EXIT_MS > 0 && Date.now() - lastWorkAt >= IDLE_EXIT_MS) break;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    lastWorkAt = Date.now();
    processed += 1;
    console.log(`[browser-job-worker] running ${job.id} (${job.type})`);
    const startedAt = Date.now();
    await runClaimedBrowserActionJob(job);
    console.log(`[browser-job-worker] finished ${job.id} in ${Date.now() - startedAt}ms`);
    if (RUN_ONCE) break;
  }

  console.log(`[browser-job-worker] stopped after processing ${processed} job(s)`);
}

main()
  .catch((error) => {
    console.error(`[browser-job-worker] fatal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
