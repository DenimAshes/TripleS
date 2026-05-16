import { NextResponse } from "next/server";
import { binaryInfo } from "cloakbrowser";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Liveness + shallow readiness probe.
// - cloakbrowser: binary status
// - db: ping latency
// - workers: most recent SyncJob age + status, count of stuck RUNNING rows,
//   pending BrowserJob queue depth — surfaces "workers are dead" in one shot
// - sessions: oldest WorkerSessionState updatedAt per service so a dashboard
//   alarm can fire on stale browser logins before a sync silently fails

async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ ok: boolean; latencyMs: number; result?: T; error?: string }> {
  const start = Date.now();
  try {
    const result = await fn();
    return { ok: true, latencyMs: Date.now() - start, result };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  let cloak: { version: string; platform: string; installed: boolean; binaryPath: string } | { error: string };
  try {
    const info = binaryInfo();
    cloak = {
      version: info.version,
      platform: info.platform,
      installed: info.installed,
      binaryPath: info.binaryPath,
    };
  } catch (error) {
    cloak = { error: error instanceof Error ? error.message : String(error) };
  }

  const dbPing = await timed("db", () => prisma.$queryRawUnsafe<Array<{ ok: number }>>("SELECT 1 AS ok"));

  const [lastJob, runningJobs, queuedJobs, sessions] = await Promise.all([
    prisma.syncJob.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true, finishedAt: true } }).catch(() => null),
    prisma.syncJob.count({ where: { status: "RUNNING", finishedAt: null } }).catch(() => -1),
    prisma.browserJob.count({ where: { status: { in: ["queued", "running"] } } }).catch(() => -1),
    prisma.workerSessionState
      .findMany({ select: { service: true, updatedAt: true } })
      .catch(() => [] as Array<{ service: string; updatedAt: Date }>),
  ]);

  const now = Date.now();
  const STALE_RUNNING_MS = Number(process.env.WORKER_RUNNING_JOB_TIMEOUT_MINUTES ?? 60) * 60_000;
  const lastJobAgeMs = lastJob ? now - lastJob.startedAt.getTime() : null;
  const sessionAges: Record<string, { updatedAt: string; ageMs: number }> = {};
  for (const row of sessions) {
    sessionAges[row.service] = { updatedAt: row.updatedAt.toISOString(), ageMs: now - row.updatedAt.getTime() };
  }

  const checks = {
    db: { ok: dbPing.ok, latencyMs: dbPing.latencyMs, error: dbPing.ok ? undefined : dbPing.error },
    cloakbrowser: cloak,
    lastSyncJob: lastJob
      ? {
          startedAt: lastJob.startedAt.toISOString(),
          finishedAt: lastJob.finishedAt?.toISOString() ?? null,
          status: lastJob.status,
          ageMs: lastJobAgeMs,
          staleRunning:
            lastJob.status === "RUNNING" &&
            !lastJob.finishedAt &&
            lastJobAgeMs !== null &&
            lastJobAgeMs > STALE_RUNNING_MS,
        }
      : null,
    runningJobs,
    queuedBrowserJobs: queuedJobs,
    sessions: sessionAges,
  };

  const isHealthy = dbPing.ok && !("error" in cloak) && runningJobs >= 0 && queuedJobs >= 0;
  return NextResponse.json(
    { ok: isHealthy, service: "triples", timestamp: new Date().toISOString(), checks },
    { status: isHealthy ? 200 : 503 },
  );
}
