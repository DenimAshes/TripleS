import { prisma } from "@/lib/db/prisma";
import { runSync } from "@/lib/sync/syncEngine";
import { getServicesInCooldown } from "@/lib/sync/serviceCooldown";
import { preflightSyncRule } from "@/lib/sync/preflight";
import { killChildPids } from "@/worker/childPidRegistry";

const RUNNING_JOB_TIMEOUT_MINUTES = Math.max(1, Number(process.env.WORKER_RUNNING_JOB_TIMEOUT_MINUTES ?? 60));

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function currentHour(timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone });
  return Number(fmt.format(new Date()));
}

function activeHoursDecision(): { skip: boolean; reason: string } {
  const tz = process.env.WORKER_ACCOUNT_TIMEZONE || "Europe/Riga";
  const start = Number(process.env.WORKER_ACTIVE_HOUR_START ?? 7);
  const end = Number(process.env.WORKER_ACTIVE_HOUR_END ?? 24);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 24 || start >= end) {
    return { skip: false, reason: `invalid WORKER_ACTIVE_HOUR_* (start=${start}, end=${end}) - running anyway` };
  }
  let hour: number;
  try {
    hour = currentHour(tz);
  } catch (error) {
    return { skip: false, reason: `failed to resolve timezone ${tz}: ${error instanceof Error ? error.message : String(error)} - running anyway` };
  }
  const active = hour >= start && hour < end;
  return active
    ? { skip: false, reason: `hour ${hour} in ${tz} inside active window [${start}, ${end})` }
    : { skip: true, reason: `hour ${hour} in ${tz} outside active window [${start}, ${end})` };
}

async function main() {
  const window = activeHoursDecision();
  console.log(`[sync-worker] ${window.reason}`);
  if (window.skip) {
    console.log("[sync-worker] Skipping run. Set WORKER_ACTIVE_HOUR_START/END or WORKER_ACCOUNT_TIMEZONE to override.");
    return;
  }

  const dueRules = await prisma.syncRule.findMany({
    where: {
      isEnabled: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
    },
    include: { destinations: { where: { isEnabled: true } } },
  });

  const cooled = await getServicesInCooldown();
  if (cooled.size > 0) {
    console.log(`[sync-worker] Services in cooldown: ${Array.from(cooled).join(", ")}`);
  }

  const notCooled = dueRules.filter((rule) => {
    const services = [rule.sourceService, ...rule.destinations.map((d) => d.service)].map((s) => s.toLowerCase());
    const blocked = services.find((s) => cooled.has(s));
    if (blocked) {
      console.log(`[sync-worker] Skipping ${rule.name} (${rule.id}) - service ${blocked} is in cooldown.`);
      return false;
    }
    return true;
  });

  for (const rule of notCooled) {
    await markStaleRunningJobs(rule.id, rule.name);
  }

  const runnable: typeof notCooled = [];
  for (const rule of notCooled) {
    const preflight = await preflightSyncRule(rule);
    if (!preflight.ok) {
      console.log(`[sync-worker] Preflight failed for ${rule.name} (${rule.id}): ${preflight.reasons.join("; ")}`);
      continue;
    }
    runnable.push(rule);
  }

  shuffleInPlace(runnable);

  const maxPerRun = Number(process.env.WORKER_MAX_RULES_PER_RUN ?? 0);
  const slice = Number.isFinite(maxPerRun) && maxPerRun > 0 ? runnable.slice(0, maxPerRun) : runnable;
  if (slice.length < runnable.length) {
    console.log(`[sync-worker] Limiting to ${slice.length}/${runnable.length} rules this tick (WORKER_MAX_RULES_PER_RUN=${maxPerRun}).`);
  }

  let ran = 0;
  let failed = 0;
  let skippedRunning = 0;
  for (const rule of slice) {
    const runningJob = await prisma.syncJob.findFirst({
      where: { syncRuleId: rule.id, status: "RUNNING" },
      select: { id: true, startedAt: true },
    });
    if (runningJob) {
      console.log(`[sync-worker] Skipping ${rule.name} (${rule.id}) because job ${runningJob.id} is already RUNNING since ${runningJob.startedAt.toISOString()}.`);
      skippedRunning += 1;
      continue;
    }
    console.log(`Running sync rule ${rule.name} (${rule.id})`);
    try {
      await runSync(rule.id);
      ran += 1;
    } catch (error) {
      failed += 1;
      console.error(`[sync-worker] runSync ${rule.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(
    `[sync-worker] summary: due=${dueRules.length} runnable=${runnable.length} sliced=${slice.length} ran=${ran} failed=${failed} skippedRunning=${skippedRunning}`,
  );
}

async function markStaleRunningJobs(syncRuleId: string, ruleName: string): Promise<void> {
  const staleBefore = new Date(Date.now() - RUNNING_JOB_TIMEOUT_MINUTES * 60 * 1000);
  const staleCandidates = await prisma.syncJob.findMany({
    where: {
      syncRuleId,
      status: "RUNNING",
      startedAt: { lt: staleBefore },
    },
    select: { id: true, childPidsJson: true },
  });
  if (!staleCandidates.length) return;

  for (const candidate of staleCandidates) {
    const pids = (() => {
      try {
        return JSON.parse(candidate.childPidsJson ?? "[]") as number[];
      } catch {
        return [];
      }
    })();
    if (pids.length) {
      const result = killChildPids(pids);
      console.log(
        `[sync-worker] Killed stale child processes for job ${candidate.id}: killed=${JSON.stringify(result.killed)} failed=${JSON.stringify(result.failed)}`,
      );
    }
  }
  const staleJobs = await prisma.syncJob.updateMany({
    where: { id: { in: staleCandidates.map((row) => row.id) } },
    data: {
      status: "FAILED",
      errorMessage: `Marked failed by worker after staying RUNNING for more than ${RUNNING_JOB_TIMEOUT_MINUTES} minutes.`,
      finishedAt: new Date(),
    },
  });
  console.log(`[sync-worker] Marked ${staleJobs.count} stale RUNNING job(s) as FAILED for ${ruleName} (${syncRuleId}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
