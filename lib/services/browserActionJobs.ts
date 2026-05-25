import type { BrowserJob as PrismaBrowserJob } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { serviceKey } from "@/lib/services/adapterFactory";
import { syncPlaylistTracksToDb, type PlaylistTrackSyncProgress } from "@/lib/services/playlistTracksStore";
import { connectPlaylistGroup, type ConnectPlaylistsInput } from "@/lib/services/playlistGroupActions";
import { runSync } from "@/lib/sync/syncEngine";
import { classifySyncError, type SyncErrorCode, type SyncErrorDetails } from "@/lib/sync/syncErrors";
import { runInActiveJob } from "@/lib/jobs/activeJobContext";
import { bindCurrentBrowserJob, killChildPids, listKnownBrowserJobChildPids } from "@/worker/childPidRegistry";

export type BrowserActionType = "playlistGroup.connect" | "playlistTracks.refresh" | "sync.run";
export type BrowserActionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

const HEARTBEAT_MS = Math.max(1000, Number(process.env.BROWSER_JOB_HEARTBEAT_MS ?? 15_000));
const CANCEL_WATCH_MS = Math.max(1000, Number(process.env.BROWSER_JOB_CANCEL_WATCH_MS ?? 2_000));

export type BrowserActionJob = {
  id: string;
  userId: string;
  type: BrowserActionType;
  status: BrowserActionStatus;
  input: unknown;
  result: unknown;
  error: string | null;
  errorCode: SyncErrorCode | null;
  errorDetails: SyncErrorDetails | null;
  currentStep: string;
  claimedAt: Date | null;
  workerId: string | null;
  attempts: number;
  startedAt: Date;
  finishedAt: Date | null;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toActionType(type: string): BrowserActionType {
  return type as BrowserActionType;
}

function toStatus(status: string): BrowserActionStatus {
  return status as BrowserActionStatus;
}

function toBrowserActionJob(row: PrismaBrowserJob): BrowserActionJob {
  return {
    id: row.id,
    userId: row.userId,
    type: toActionType(row.type),
    status: toStatus(row.status),
    input: parseJson(row.inputJson, null),
    result: parseJson(row.resultJson, null),
    error: row.errorMessage,
    errorCode: (row.errorCode as SyncErrorCode | null) ?? null,
    errorDetails: parseJson<SyncErrorDetails | null>(row.errorDetailsJson, null),
    currentStep: row.currentStep,
    claimedAt: row.claimedAt,
    workerId: row.workerId,
    attempts: row.attempts,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function shouldRunInline(): boolean {
  return process.env.BROWSER_JOB_EXECUTION_MODE !== "worker";
}

function dedupeWhere(userId: string, type: BrowserActionType, input: unknown) {
  return {
    userId,
    type,
    status: { in: ["queued", "running"] },
    inputJson: JSON.stringify(input ?? {}),
  };
}

async function setJob(id: string, patch: Partial<BrowserActionJob>) {
  await prisma.browserJob.update({
    where: { id },
    data: {
      status: patch.status,
      resultJson: patch.result === undefined ? undefined : JSON.stringify(patch.result),
      errorMessage: patch.error,
      errorCode: patch.errorCode,
      errorDetailsJson: patch.errorDetails === undefined ? undefined : patch.errorDetails ? JSON.stringify(patch.errorDetails) : null,
      childPidsJson: patch.status === "succeeded" || patch.status === "failed" || patch.status === "cancelled" ? null : undefined,
      currentStep: patch.currentStep,
      finishedAt: patch.finishedAt,
    },
  });
}

async function isTerminalJob(id: string): Promise<boolean> {
  const row = await prisma.browserJob.findUnique({ where: { id }, select: { status: true } });
  return row?.status === "succeeded" || row?.status === "failed" || row?.status === "cancelled";
}

function parsePidList(value: string | null): number[] {
  return parseJson<number[]>(value, []).filter((pid) => Number.isFinite(pid) && pid > 0);
}

function startRuntimeWatch(jobId: string, abortController: AbortController): () => void {
  let stopped = false;
  let cancellationHandled = false;

  const heartbeat = setInterval(() => {
    if (stopped) return;
    void prisma.browserJob
      .updateMany({
        where: { id: jobId, status: "running" },
        data: { updatedAt: new Date() },
      })
      .catch(() => {});
  }, HEARTBEAT_MS);

  const cancellationWatch = setInterval(() => {
    if (stopped || cancellationHandled) return;
    void prisma.browserJob
      .findUnique({ where: { id: jobId }, select: { status: true, childPidsJson: true } })
      .then((row) => {
        if (row?.status !== "cancelled") return;
        cancellationHandled = true;
        abortController.abort();
        const persistedPids = parsePidList(row.childPidsJson);
        const livePids = listKnownBrowserJobChildPids();
        const pids = Array.from(new Set([...persistedPids, ...livePids]));
        if (pids.length) killChildPids(pids);
      })
      .catch(() => {});
  }, CANCEL_WATCH_MS);

  heartbeat.unref?.();
  cancellationWatch.unref?.();

  return () => {
    stopped = true;
    clearInterval(heartbeat);
    clearInterval(cancellationWatch);
  };
}

function playlistTrackProgressStep(progress: PlaylistTrackSyncProgress): string {
  const total = progress.total || 0;
  if (progress.phase === "reading") {
    if (progress.current > 0) {
      return total > 0
        ? `Still reading from service (${progress.current}s, ${total} expected)`
        : `Still reading from service (${progress.current}s)`;
    }
    return total > 0 ? `Opening service playlist (${total} expected)` : "Opening service playlist";
  }
  if (progress.phase === "tracks") return `Read ${progress.current} tracks from service`;
  if (progress.phase === "serviceTracks") return `Preparing track metadata (${progress.current}/${progress.total})`;
  if (progress.phase === "cache") return `Caching tracks (${progress.current}/${progress.total})`;
  return `Cached ${progress.current} tracks`;
}

async function countPendingManualReviews(userId: string, playlistIds: string[]): Promise<number> {
  if (!playlistIds.length) return 0;
  const states = await prisma.playlistTrackState.findMany({
    where: { playlistId: { in: playlistIds }, removedAt: null },
    select: { serviceTrackId: true },
  });
  const sourceServiceTrackIds = states.map((state) => state.serviceTrackId);
  if (!sourceServiceTrackIds.length) return 0;
  return prisma.manualMatchCandidate.count({
    where: {
      userId,
      status: "PENDING",
      sourceServiceTrackId: { in: sourceServiceTrackIds },
    },
  });
}

async function runInitialPlaylistGroupSync(job: BrowserActionJob, input: ConnectPlaylistsInput) {
  if (input.runInitialSync === false) return null;
  await setJob(job.id, { currentStep: "Loading source playlist" });
  const sourcePlaylist = await prisma.playlist.findUnique({ where: { id: input.sourcePlaylistId } });
  if (!sourcePlaylist || sourcePlaylist.userId !== job.userId) {
    throw new Error("Source playlist not found");
  }
  if (await isTerminalJob(job.id)) return null;

  const groupMember = await prisma.playlistGroupMember.findUnique({
    where: { playlistId: sourcePlaylist.id },
    select: { groupId: true },
  });
  const groupMembers = groupMember
    ? await prisma.playlistGroupMember.findMany({
        where: { groupId: groupMember.groupId },
        include: { playlist: true },
        orderBy: { service: "asc" },
      })
    : [{ playlist: sourcePlaylist }];
  const sourceFirst = [...groupMembers].sort((a, b) => {
    if (a.playlist.id === sourcePlaylist.id) return -1;
    if (b.playlist.id === sourcePlaylist.id) return 1;
    return a.playlist.service.localeCompare(b.playlist.service);
  });

  const sourceRefreshes = [];
  const sourceErrors = [];
  const refreshFailedPlaylistIds = new Set<string>();
  for (const member of sourceFirst) {
    await setJob(job.id, { currentStep: `Reading ${member.playlist.service} source tracks` });
    try {
      const refresh = await syncPlaylistTracksToDb(
        job.userId,
        serviceKey(member.playlist.service),
        member.playlist.servicePlaylistId,
        (progress) => setJob(job.id, { currentStep: playlistTrackProgressStep(progress) }),
      );
      sourceRefreshes.push({ playlistId: member.playlist.id, service: member.playlist.service, result: refresh });
    } catch (error) {
      refreshFailedPlaylistIds.add(member.playlist.id);
      sourceErrors.push({
        playlistId: member.playlist.id,
        service: member.playlist.service,
        phase: "refresh",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (await isTerminalJob(job.id)) return null;
  }

  await setJob(job.id, { currentStep: "Starting first sync" });
  const rules = await prisma.syncRule.findMany({
    where: {
      userId: job.userId,
      isEnabled: true,
      direction: "TWO_WAY",
      OR: sourceFirst.map((member) => ({
        sourceService: member.playlist.service,
        sourcePlaylistId: member.playlist.servicePlaylistId,
      })),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!rules.length) throw new Error("No sync rule found for the connected playlist");
  const ruleBySource = new Map(rules.map((rule) => [`${rule.sourceService}:${rule.sourcePlaylistId}`, rule]));
  const syncJobs = [];
  const syncErrors = [];
  for (const member of sourceFirst) {
    if (refreshFailedPlaylistIds.has(member.playlist.id)) continue;
    const rule = ruleBySource.get(`${member.playlist.service}:${member.playlist.servicePlaylistId}`);
    if (!rule) continue;
    await setJob(job.id, { currentStep: `Syncing changes from ${member.playlist.service}` });
    try {
      syncJobs.push(await runSync(rule.id));
    } catch (error) {
      syncErrors.push({
        ruleId: rule.id,
        service: member.playlist.service,
        phase: "sync",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (await isTerminalJob(job.id)) return null;
  }
  if (!syncJobs.length && syncErrors.length) {
    throw new Error(`Initial sync failed for every source: ${syncErrors.map((item) => `${item.service}: ${item.error}`).join("; ")}`);
  }
  const pendingReviewCount = await countPendingManualReviews(
    job.userId,
    sourceFirst.map((member) => member.playlist.id),
  );
  return { sourceRefreshes, sourceErrors, syncJobs, syncErrors, pendingReviewCount };
}

async function runAction(job: BrowserActionJob) {
  bindCurrentBrowserJob(job.id);
  const abortController = new AbortController();
  let stopRuntimeWatch: (() => void) | null = null;
  if (await isTerminalJob(job.id)) {
    bindCurrentBrowserJob(null);
    return;
  }
  await setJob(job.id, { status: "running", currentStep: "Starting" });
  stopRuntimeWatch = startRuntimeWatch(job.id, abortController);
  try {
    await runInActiveJob({ jobId: job.id, abortController }, async () => {
      if (job.type === "playlistGroup.connect") {
        await setJob(job.id, { currentStep: "Creating or connecting playlist" });
        const input = job.input as ConnectPlaylistsInput;
        const group = await connectPlaylistGroup(job.userId, input);
        if (await isTerminalJob(job.id)) return;
        const initialSync = await runInitialPlaylistGroupSync(job, input);
        if (await isTerminalJob(job.id)) return;
        await setJob(job.id, { status: "succeeded", result: { group, initialSync }, currentStep: "Finished", finishedAt: new Date() });
        return;
      }

      if (job.type === "playlistTracks.refresh") {
        const input = job.input as { playlistId?: string };
        if (!input.playlistId) throw new Error("playlistId is required");
        await setJob(job.id, { currentStep: "Loading playlist" });
        const playlist = await prisma.playlist.findUnique({ where: { id: input.playlistId } });
        if (!playlist || playlist.userId !== job.userId) throw new Error("Playlist not found");
        if (await isTerminalJob(job.id)) return;
        await setJob(job.id, { currentStep: `Refreshing ${playlist.service} tracks` });
        const result = await syncPlaylistTracksToDb(
          job.userId,
          serviceKey(playlist.service),
          playlist.servicePlaylistId,
          (progress) => setJob(job.id, { currentStep: playlistTrackProgressStep(progress) }),
        );
        if (await isTerminalJob(job.id)) return;
        await setJob(job.id, { status: "succeeded", result, currentStep: "Finished", finishedAt: new Date() });
        return;
      }

      if (job.type === "sync.run") {
        const input = job.input as { syncRuleId?: string };
        if (!input.syncRuleId) throw new Error("syncRuleId is required");
        await setJob(job.id, { currentStep: "Loading sync rule" });
        const rule = await prisma.syncRule.findFirst({ where: { id: input.syncRuleId, userId: job.userId } });
        if (!rule) throw new Error("No sync rule found");
        if (await isTerminalJob(job.id)) return;
        await setJob(job.id, { currentStep: "Running sync" });
        const result = await runSync(rule.id);
        if (await isTerminalJob(job.id)) return;
        await setJob(job.id, { status: "succeeded", result, currentStep: "Finished", finishedAt: new Date() });
        return;
      }

      throw new Error(`Unsupported browser action: ${job.type}`);
    });
  } catch (error) {
    if (await isTerminalJob(job.id)) return;
    const classified = classifySyncError(error);
    await setJob(job.id, {
      status: "failed",
      error: classified.message,
      errorCode: classified.code,
      errorDetails: classified.details,
      currentStep: "Failed",
      finishedAt: new Date(),
    });
  } finally {
    stopRuntimeWatch?.();
    const remainingPids = listKnownBrowserJobChildPids();
    if (remainingPids.length) {
      killChildPids(remainingPids);
    }
    bindCurrentBrowserJob(null);
  }
}

export async function startBrowserActionJob(userId: string, type: BrowserActionType, input: unknown): Promise<BrowserActionJob> {
  const normalizedInput = input ?? {};
  const running = await prisma.browserJob.findFirst({
    where: dedupeWhere(userId, type, normalizedInput),
    orderBy: { createdAt: "desc" },
  });
  if (running) {
    const job = toBrowserActionJob(running);
    if (shouldRunInline() && job.status === "queued") {
      void runAction(job);
    }
    return job;
  }

  const row = await prisma.browserJob.create({
    data: {
      userId,
      type,
      status: "queued",
      inputJson: JSON.stringify(normalizedInput),
      currentStep: "Queued",
    },
  });
  const job = toBrowserActionJob(row);
  if (shouldRunInline()) {
    void runAction(job);
  }
  return job;
}

export async function claimQueuedBrowserActionJob(workerId: string | null = null): Promise<BrowserActionJob | null> {
  const row = await prisma.browserJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });
  if (!row) return null;

  const claimedAt = new Date();
  const claimed = await prisma.browserJob.updateMany({
    where: { id: row.id, status: "queued" },
    data: {
      status: "running",
      currentStep: workerId ? `Claimed by ${workerId}` : "Claimed by worker",
      claimedAt,
      workerId,
      attempts: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return null;

  const fresh = await prisma.browserJob.findUnique({ where: { id: row.id } });
  return fresh ? toBrowserActionJob(fresh) : null;
}

export async function runClaimedBrowserActionJob(job: BrowserActionJob): Promise<void> {
  if (job.status !== "running") {
    throw new Error(`Browser job ${job.id} must be running before execution (got ${job.status})`);
  }
  await runAction(job);
}

export async function runNextQueuedBrowserActionJob(): Promise<BrowserActionJob | null> {
  const job = await claimQueuedBrowserActionJob();
  if (!job) return null;
  await runClaimedBrowserActionJob(job);
  return getBrowserActionJob(job.userId, job.id);
}

const BROWSER_JOB_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.BROWSER_JOB_MAX_ATTEMPTS ?? 3),
);

export async function reclaimStaleBrowserActionJobs(staleAfterMs: number): Promise<number> {
  const threshold = new Date(Date.now() - Math.max(1, staleAfterMs));
  const staleJobs = await prisma.browserJob.findMany({
    where: {
      status: "running",
      updatedAt: { lt: threshold },
    },
    select: { id: true, childPidsJson: true, attempts: true },
  });
  if (staleJobs.length === 0) return 0;

  for (const job of staleJobs) {
    const pids = parseJson<number[]>(job.childPidsJson, []).filter((pid) => Number.isFinite(pid) && pid > 0);
    if (pids.length) killChildPids(pids);
  }

  // Auto-retry transient runner timeouts up to BROWSER_JOB_MAX_ATTEMPTS by
  // re-queueing instead of failing outright. claimQueuedBrowserActionJob
  // increments attempts on every claim, so this is a true retry counter.
  const retryable = staleJobs.filter((job) => job.attempts < BROWSER_JOB_MAX_ATTEMPTS);
  const exhausted = staleJobs.filter((job) => job.attempts >= BROWSER_JOB_MAX_ATTEMPTS);

  let updated = 0;
  if (retryable.length) {
    const requeued = await prisma.browserJob.updateMany({
      where: {
        id: { in: retryable.map((job) => job.id) },
        status: "running",
        updatedAt: { lt: threshold },
      },
      data: {
        status: "queued",
        currentStep: "Reclaimed after runner timeout, will retry",
        claimedAt: null,
        workerId: null,
        childPidsJson: null,
      },
    });
    updated += requeued.count;
  }
  if (exhausted.length) {
    const failed = await prisma.browserJob.updateMany({
      where: {
        id: { in: exhausted.map((job) => job.id) },
        status: "running",
        updatedAt: { lt: threshold },
      },
      data: {
        status: "failed",
        currentStep: "Failed",
        errorCode: "RUNNER_TIMEOUT",
        errorMessage: `Browser job worker did not update this job for ${Math.round(staleAfterMs / 1000)}s after ${BROWSER_JOB_MAX_ATTEMPTS} attempt(s).`,
        errorDetailsJson: JSON.stringify({
          recommendedAction: "Retry manually; if it repeats, check browser worker logs and runner timeouts.",
        }),
        childPidsJson: null,
        finishedAt: new Date(),
      },
    });
    updated += failed.count;
  }
  return updated;
}

export async function getBrowserActionJob(userId: string, id: string): Promise<BrowserActionJob | null> {
  const row = await prisma.browserJob.findFirst({ where: { id, userId } });
  return row ? toBrowserActionJob(row) : null;
}

export async function cancelBrowserActionJob(userId: string, id: string, reason = "Cancelled by user"): Promise<BrowserActionJob | null> {
  const row = await prisma.browserJob.findFirst({ where: { id, userId } });
  if (!row) return null;
  if (row.status === "succeeded" || row.status === "failed" || row.status === "cancelled") {
    return toBrowserActionJob(row);
  }
  const pids = parsePidList(row.childPidsJson);
  const killResult = killChildPids(pids);
  const updated = await prisma.browserJob.update({
    where: { id },
    data: {
      status: "cancelled",
      currentStep: "Cancelled",
      errorCode: "CANCELLED",
      errorMessage: reason,
      errorDetailsJson: JSON.stringify({
        recommendedAction: "Start a new job when ready.",
        hint: killResult.killed.length ? `Killed child runner PIDs: ${killResult.killed.join(", ")}` : undefined,
      }),
      childPidsJson: null,
      finishedAt: new Date(),
    },
  });
  return toBrowserActionJob(updated);
}

export function serializeBrowserActionJob(job: BrowserActionJob) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    currentStep: job.currentStep,
    claimedAt: job.claimedAt,
    workerId: job.workerId,
    attempts: job.attempts,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    errorCode: job.errorCode,
    errorDetails: job.errorDetails,
    result: job.result,
  };
}
