import { prisma } from "@/lib/db/prisma";
import { preflightSyncRule } from "@/lib/sync/preflight";
import { runSync } from "@/lib/sync/syncEngine";
import { getServicesInCooldown } from "@/lib/sync/serviceCooldown";
import { shouldRefreshSourceCache } from "@/lib/sync/sourceCachePolicy";
import { applyGroupAwareRuleLimit, buildSourcePlaylistGroupMap } from "@/lib/sync/groupAwareRuleLimit";
import type { Prisma } from "@prisma/client";

const RUNNING_JOB_TIMEOUT_MINUTES = Math.max(1, Number(process.env.CRON_RUNNING_JOB_TIMEOUT_MINUTES ?? 60));

type DueSyncRule = Prisma.SyncRuleGetPayload<{ include: { destinations: true } }>;

export type DueSyncSkippedRule = {
  syncRuleId: string;
  name: string;
  reason: "cooldown" | "already_running" | "preflight" | "limit";
  detail: string;
};

export type DueSyncFailure = {
  syncRuleId: string;
  name: string;
  error: string;
};

export type DueSyncRunnerResult = {
  jobs: unknown[];
  failures: DueSyncFailure[];
  skipped: DueSyncSkippedRule[];
  summary: {
    due: number;
    succeeded: number;
    failed: number;
    skipped: number;
    staleMarked: number;
  };
};

function touchedServices(rule: {
  sourceService: string;
  destinations: Array<{ service: string }>;
}): string[] {
  return [rule.sourceService, ...rule.destinations.map((destination) => destination.service)].map((service) => service.toLowerCase());
}

function maxRulesPerRun(): number {
  const value = Number(process.env.CRON_MAX_RULES_PER_RUN ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function markStaleRunningJobs(syncRuleId: string): Promise<number> {
  const staleBefore = new Date(Date.now() - RUNNING_JOB_TIMEOUT_MINUTES * 60 * 1000);
  const staleJobs = await prisma.syncJob.findMany({
    where: {
      syncRuleId,
      status: "RUNNING",
      startedAt: { lt: staleBefore },
      finishedAt: null,
    },
    select: { id: true },
  });
  if (!staleJobs.length) return 0;

  const updated = await prisma.syncJob.updateMany({
    where: { id: { in: staleJobs.map((job) => job.id) } },
    data: {
      status: "FAILED",
      errorMessage: `Marked failed by cron after staying RUNNING for more than ${RUNNING_JOB_TIMEOUT_MINUTES} minutes.`,
      finishedAt: new Date(),
    },
  });
  return updated.count;
}

export async function runDueSyncRules(options: { userId?: string } = {}): Promise<DueSyncRunnerResult> {
  const rules = await prisma.syncRule.findMany({
    where: {
      userId: options.userId,
      isEnabled: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
    },
    include: { destinations: { where: { isEnabled: true } } },
    orderBy: { nextRunAt: "asc" },
  });
  const cooled = await getServicesInCooldown();
  const jobs: unknown[] = [];
  const failures: DueSyncFailure[] = [];
  const skipped: DueSyncSkippedRule[] = [];
  let staleMarked = 0;
  const maxRules = maxRulesPerRun();
  const runnable: DueSyncRule[] = [];

  for (const rule of rules as DueSyncRule[]) {
    const blockedService = touchedServices(rule).find((service) => cooled.has(service));
    if (blockedService) {
      skipped.push({
        syncRuleId: rule.id,
        name: rule.name,
        reason: "cooldown",
        detail: `${blockedService} is in cooldown`,
      });
      continue;
    }

    staleMarked += await markStaleRunningJobs(rule.id);

    const runningJob = await prisma.syncJob.findFirst({
      where: { syncRuleId: rule.id, status: "RUNNING", finishedAt: null },
      select: { id: true, startedAt: true },
      orderBy: { startedAt: "desc" },
    });
    if (runningJob) {
      skipped.push({
        syncRuleId: rule.id,
        name: rule.name,
        reason: "already_running",
        detail: `Job ${runningJob.id} is RUNNING since ${runningJob.startedAt.toISOString()}`,
      });
      continue;
    }

    const sourcePlaylist = await prisma.playlist.findUnique({
      where: {
        service_servicePlaylistId: {
          service: rule.sourceService,
          servicePlaylistId: rule.sourcePlaylistId,
        },
      },
      select: { lastFetchedAt: true },
    });
    const preflight = await preflightSyncRule(rule, {
      allowIncompleteSourceCache: shouldRefreshSourceCache({ lastFetchedAt: sourcePlaylist?.lastFetchedAt }),
    });
    if (!preflight.ok) {
      skipped.push({
        syncRuleId: rule.id,
        name: rule.name,
        reason: "preflight",
        detail: preflight.reasons.join("; "),
      });
      continue;
    }

    runnable.push(rule);
  }

  const groupMembers = runnable.length
    ? await prisma.playlistGroupMember.findMany({
        where: {
          playlist: {
            OR: runnable
              .filter((rule) => rule.sourcePlaylistId)
              .map((rule) => ({
                service: rule.sourceService,
                servicePlaylistId: rule.sourcePlaylistId,
              })),
          },
        },
        select: {
          groupId: true,
          playlist: { select: { service: true, servicePlaylistId: true } },
        },
      })
    : [];
  const groupMap = buildSourcePlaylistGroupMap(groupMembers);
  const limited = applyGroupAwareRuleLimit(runnable, groupMap, maxRules);

  for (const rule of limited.skipped) {
    skipped.push({
      syncRuleId: rule.id,
      name: rule.name,
      reason: "limit",
      detail: `CRON_MAX_RULES_PER_RUN=${maxRules}`,
    });
  }

  for (const rule of limited.selected) {
    try {
      jobs.push(await runSync(rule.id));
    } catch (error) {
      failures.push({
        syncRuleId: rule.id,
        name: rule.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    jobs,
    failures,
    skipped,
    summary: {
      due: rules.length,
      succeeded: jobs.length,
      failed: failures.length,
      skipped: skipped.length,
      staleMarked,
    },
  };
}
