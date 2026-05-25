import type { Prisma, ServiceTrack, SyncJob } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getAdapter, serviceKey } from "@/lib/services/adapterFactory";
import {
  closeAllPersistentRunners,
  ensurePersistentRunner,
  persistentRunnersEnabled,
} from "@/lib/services/persistentRunnerRegistry";
import { syncPlaylistTracksToDb } from "@/lib/services/playlistTracksStore";
import type { NormalizedTrack, ServiceKey } from "./syncTypes";
import { findMatch, prewarmLocalCatalog, type LocalCatalogPool } from "./matchEngine";
import { upsertAutoTrackMatch } from "./trackMatchStore";
import {
  buildMatchContext,
  bulkUpsertServiceTracks,
  lookupExistingInPlaylist,
  lookupIsrcMatch,
  lookupStoredMatch,
} from "./matchContext";
import { isReadComplete, PartialSourceReadError, writePlaylistSnapshot } from "./snapshot";
import { parseArtistsJson } from "@/lib/utils/parseArtists";
import { classifyError, nextRunAfterFailure } from "./failureClassifier";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("triples:sync-engine");
import { recordCooldownForRule, recordSuccessForRule } from "./serviceCooldown";
import { shouldRefreshSourceCache, sourceCacheMaxAgeMs } from "./sourceCachePolicy";
import { releaseAllSessions } from "@/worker/sessionPool";
import { preflightSyncRule } from "./preflight";
import { bindCurrentJob, killChildPids, listKnownChildPids } from "@/worker/childPidRegistry";
import { CancelledError, throwIfActiveJobAborted } from "@/lib/jobs/activeJobContext";

const WRITE_THROTTLE_MIN_MS = Number(process.env.WORKER_WRITE_THROTTLE_MIN_MS ?? 4000);
const WRITE_THROTTLE_SPREAD_MS = Number(process.env.WORKER_WRITE_THROTTLE_SPREAD_MS ?? 8000);
const WRITE_BURST_LONG_PAUSE_MIN_MS = Number(process.env.WORKER_WRITE_LONG_PAUSE_MIN_MS ?? 60_000);
const WRITE_BURST_LONG_PAUSE_SPREAD_MS = Number(process.env.WORKER_WRITE_LONG_PAUSE_SPREAD_MS ?? 120_000);
const MAX_TRACKS_PER_RUN = Number(process.env.WORKER_MAX_TRACKS_PER_RUN ?? 10);
const AUTO_MATCH_THRESHOLD = Number(process.env.WORKER_AUTO_MATCH_THRESHOLD ?? 0.82);
const MANUAL_REVIEW_THRESHOLD = Number(process.env.WORKER_MANUAL_REVIEW_THRESHOLD ?? 0.65);
const SKIP_PREVIOUSLY_LOGGED = process.env.WORKER_SKIP_PREVIOUSLY_LOGGED !== "false";
const REFRESH_SOURCE_TRACKS = process.env.WORKER_REFRESH_SOURCE_TRACKS === "true";
const SOURCE_CACHE_MAX_AGE_MS = sourceCacheMaxAgeMs();
const MATCH_CONCURRENCY = Math.max(1, Number(process.env.WORKER_MATCH_CONCURRENCY ?? 4));
const RUNNING_JOB_TIMEOUT_MINUTES = Math.max(1, Number(process.env.WORKER_RUNNING_JOB_TIMEOUT_MINUTES ?? 60));
const REQUIRE_PREFLIGHT = process.env.WORKER_REQUIRE_PREFLIGHT !== "false";
const SYNC_JOB_TIMEOUT_MS = Math.max(60_000, Number(process.env.WORKER_SYNC_JOB_TIMEOUT_MS ?? 30 * 60_000));

export { PartialSourceReadError };

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      throwIfActiveJobAborted();
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

type ThrottleState = { writesSinceLongPause: number; writesBeforeNextLongPause: number };
const throttleStateByService = new Map<string, ThrottleState>();
function getThrottleState(service: string): ThrottleState {
  let state = throttleStateByService.get(service);
  if (!state) {
    state = { writesSinceLongPause: 0, writesBeforeNextLongPause: 2 + Math.floor(Math.random() * 3) };
    throttleStateByService.set(service, state);
  }
  return state;
}

function writeThrottle(service: string): Promise<void> {
  const state = getThrottleState(service);
  state.writesSinceLongPause += 1;
  const useLong = state.writesSinceLongPause >= state.writesBeforeNextLongPause;
  if (useLong) {
    state.writesSinceLongPause = 0;
    state.writesBeforeNextLongPause = 2 + Math.floor(Math.random() * 3);
    const min = Math.max(0, WRITE_BURST_LONG_PAUSE_MIN_MS);
    const spread = Math.max(0, WRITE_BURST_LONG_PAUSE_SPREAD_MS);
    const ms = min + Math.floor(Math.random() * spread);
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
  }
  const min = Number.isFinite(WRITE_THROTTLE_MIN_MS) && WRITE_THROTTLE_MIN_MS > 0 ? WRITE_THROTTLE_MIN_MS : 0;
  const spread = Number.isFinite(WRITE_THROTTLE_SPREAD_MS) && WRITE_THROTTLE_SPREAD_MS > 0 ? WRITE_THROTTLE_SPREAD_MS : 0;
  const ms = min + Math.floor(Math.random() * spread);
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function upsertServiceTrack(track: NormalizedTrack): Promise<ServiceTrack> {
  const byKey = await bulkUpsertServiceTracks([track]);
  const serviceTrack = byKey.get(`${track.sourceService}::${track.sourceTrackId}`);
  if (!serviceTrack) {
    throw new Error(`bulkUpsertServiceTracks did not return entry for ${track.sourceService}::${track.sourceTrackId}`);
  }
  return serviceTrack;
}

function normalizedFromServiceTrack(track: ServiceTrack): NormalizedTrack {
  return {
    title: track.title,
    artists: parseArtistsJson(track.artistsJson),
    album: track.album || undefined,
    durationMs: track.durationMs || undefined,
    isrc: track.isrc || undefined,
    sourceService: serviceKey(track.service),
    sourceTrackId: track.serviceTrackId,
    url: track.url || undefined,
    imageUrl: track.imageUrl || undefined,
  };
}

async function getPlaylistTracksFromDb(playlistId: string): Promise<NormalizedTrack[]> {
  const states = await prisma.playlistTrackState.findMany({
    where: { playlistId, removedAt: null },
    include: { serviceTrack: true },
    orderBy: { position: "asc" },
  });
  return states.map((state) => normalizedFromServiceTrack(state.serviceTrack));
}

function nextScheduledRun(intervalMinutes: number) {
  return intervalMinutes > 0 ? new Date(Date.now() + intervalMinutes * 60_000) : null;
}

function shouldRefreshSourceTracks(sourcePlaylist: { lastFetchedAt: Date | null } | null): boolean {
  return shouldRefreshSourceCache({
    lastFetchedAt: sourcePlaylist?.lastFetchedAt,
    forceRefresh: REFRESH_SOURCE_TRACKS,
    maxAgeMs: SOURCE_CACHE_MAX_AGE_MS,
  });
}

function boundedTrackCount(): number {
  return Number.isFinite(MAX_TRACKS_PER_RUN) && MAX_TRACKS_PER_RUN > 0 ? Math.floor(MAX_TRACKS_PER_RUN) : 0;
}

const PREVIOUSLY_LOGGED_WINDOW_DAYS = Math.max(0, Number(process.env.WORKER_PREVIOUSLY_LOGGED_WINDOW_DAYS ?? 30));

async function getPreviouslyLoggedTitles(syncRuleId: string, service: string, playlistId: string): Promise<Set<string>> {
  if (!SKIP_PREVIOUSLY_LOGGED) return new Set();
  const since = PREVIOUSLY_LOGGED_WINDOW_DAYS > 0
    ? new Date(Date.now() - PREVIOUSLY_LOGGED_WINDOW_DAYS * 24 * 60 * 60_000)
    : undefined;
  const logs = await prisma.syncLog.findMany({
    where: {
      service,
      playlistId,
      action: {
        in: ["synced", "already_synced", "rejected_candidate"],
      },
      syncJob: {
        syncRuleId,
      },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: { trackTitle: true },
    distinct: ["trackTitle"],
  });
  return new Set(logs.map((log) => log.trackTitle));
}

async function getDestinationPlaylist(service: string, servicePlaylistId: string) {
  return prisma.playlist.findUnique({
    where: {
      service_servicePlaylistId: {
        service,
        servicePlaylistId,
      },
    },
  });
}

async function markPlaylistTrackPresent(
  playlistId: string,
  serviceTrackId: string,
  addedBySystem: boolean,
  existing?: { id: string; addedBySystem: boolean } | null,
) {
  if (existing) {
    return prisma.playlistTrackState.update({
      where: { id: existing.id },
      data: {
        addedBySystem: existing.addedBySystem || addedBySystem,
        lastSeenAt: new Date(),
      },
    });
  }

  const lastPosition = await prisma.playlistTrackState.count({ where: { playlistId } });
  return prisma.playlistTrackState.create({
    data: {
      playlistId,
      serviceTrackId,
      position: lastPosition + 1,
      addedBySystem,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}

async function upsertManualCandidate({
  userId,
  sourceServiceTrackId,
  targetService,
  candidateServiceTrackId,
  confidence,
  alternatives = [],
}: {
  userId: string;
  sourceServiceTrackId: string;
  targetService: string;
  candidateServiceTrackId: string;
  confidence: number;
  alternatives?: Array<{ serviceTrackId: string; confidence: number; breakdown?: unknown }>;
}) {
  const naturalKey = {
    userId,
    sourceServiceTrackId,
    targetService,
    candidateServiceTrackId,
  };
  const existing = await prisma.manualMatchCandidate.findUnique({
    where: { ManualMatchCandidate_natural_key: naturalKey },
  });
  if (existing?.status === "REJECTED") {
    return { candidate: existing, status: "REJECTED" as const };
  }

  const candidate = await prisma.manualMatchCandidate.upsert({
    where: { ManualMatchCandidate_natural_key: naturalKey },
    update: {
      confidence: existing ? Math.max(existing.confidence, confidence) : confidence,
      alternativesJson: JSON.stringify(alternatives),
    },
    create: {
      ...naturalKey,
      confidence,
      alternativesJson: JSON.stringify(alternatives),
      status: "PENDING",
    },
  });
  return { candidate, status: candidate.status };
}

export async function runSync(syncRuleId: string): Promise<SyncJob> {
  throwIfActiveJobAborted();
  const rule = await prisma.syncRule.findUnique({
    where: { id: syncRuleId },
    include: { destinations: { where: { isEnabled: true } } },
  });
  if (!rule) throw new Error("SyncRule not found");

  const sourcePlaylistForRun = await prisma.playlist.findUnique({
    where: {
      service_servicePlaylistId: {
        service: rule.sourceService,
        servicePlaylistId: rule.sourcePlaylistId,
      },
    },
    select: { id: true, lastFetchedAt: true },
  });
  const refreshSourceTracks = shouldRefreshSourceTracks(sourcePlaylistForRun);

  if (REQUIRE_PREFLIGHT) {
    const preflight = await preflightSyncRule(rule, {
      allowIncompleteSourceCache: refreshSourceTracks,
    });
    if (!preflight.ok) {
      throw new Error(`Preflight failed for SyncRule ${rule.id}: ${preflight.reasons.join("; ")}`);
    }
  }

  const staleBefore = new Date(Date.now() - RUNNING_JOB_TIMEOUT_MINUTES * 60_000);
  await prisma.syncJob.updateMany({
    where: {
      syncRuleId,
      status: "RUNNING",
      startedAt: { lt: staleBefore },
      finishedAt: null,
    },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorMessage: `Sync job expired after ${RUNNING_JOB_TIMEOUT_MINUTES} minutes without finishing.`,
    },
  });

  const sourceGroupMemberForLock =
    rule.direction === "TWO_WAY" && sourcePlaylistForRun
      ? await prisma.playlistGroupMember.findUnique({
          where: { playlistId: sourcePlaylistForRun.id },
          select: { groupId: true },
        })
      : null;
  const lockKeys = [
    sourceGroupMemberForLock?.groupId ? `playlist_group:${sourceGroupMemberForLock.groupId}` : null,
    `sync_rule:${syncRuleId}`,
  ].filter((key): key is string => Boolean(key));
  const job = await prisma.$transaction(async (tx) => {
    for (const lockKey of lockKeys) {
      const lockAcquired = await tx
        .$queryRawUnsafe<Array<{ pg_try_advisory_lock: boolean }>>(
          `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS pg_try_advisory_lock`,
          lockKey,
        )
        .then((rows) => rows[0]?.pg_try_advisory_lock === true)
        .catch(() => false);
      if (!lockAcquired) {
        const target = lockKey.startsWith("playlist_group:") ? "playlist group" : "sync rule";
        throw new Error(`Could not acquire advisory lock for ${target}; another sync is already starting.`);
      }
    }

    const running = await tx.syncJob.findFirst({
      where: { syncRuleId, status: "RUNNING", finishedAt: null },
      orderBy: { startedAt: "desc" },
    });
    if (running) {
      throw new Error(`SyncRule already has a RUNNING job (${running.id}) started at ${running.startedAt.toISOString()}`);
    }

    if (sourceGroupMemberForLock?.groupId) {
      const groupMembers = await tx.playlistGroupMember.findMany({
        where: { groupId: sourceGroupMemberForLock.groupId },
        include: { playlist: { select: { service: true, servicePlaylistId: true } } },
      });
      const runningGroupJob = await tx.syncJob.findFirst({
        where: {
          status: "RUNNING",
          finishedAt: null,
          syncRule: {
            userId: rule.userId,
            direction: "TWO_WAY",
            OR: groupMembers.map((member) => ({
              sourceService: member.playlist.service,
              sourcePlaylistId: member.playlist.servicePlaylistId,
            })),
          },
        },
        orderBy: { startedAt: "desc" },
      });
      if (runningGroupJob) {
        throw new Error(
          `Playlist group already has a RUNNING sync job (${runningGroupJob.id}) started at ${runningGroupJob.startedAt.toISOString()}`,
        );
      }
    }

    return tx.syncJob.create({
      data: {
        syncRuleId,
        status: "RUNNING",
        startedAt: new Date(),
        statsJson: JSON.stringify({ synced: 0, alreadySynced: 0, notFound: 0, manualRequired: 0, removed: 0 }),
      },
    });
  });
  bindCurrentJob(job.id);

  // Pre-warm persistent runners for the services this rule touches when the
  // feature flag is on. Each subsequent adapter call within this run skips
  // the cloak browser cold-start (~15-20s) — biggest win for runs with many
  // SoundCloud searches. Failure to spawn is non-fatal; runnerInvoker falls
  // back to the one-shot CLI path automatically.
  if (persistentRunnersEnabled()) {
    const services = new Set<string>([rule.sourceService, ...rule.destinations.map((d) => d.service)]);
    for (const service of services) {
      const key = serviceKey(service);
      if (key === "youtube" || key === "soundcloud") {
        await ensurePersistentRunner(key).catch((err) => {
          log.warn("failed to start persistent runner", { service: key, error: err instanceof Error ? err.message : String(err) });
        });
      }
    }
  }

  type PerDestinationStats = {
    synced: number;
    alreadySynced: number;
    notFound: number;
    manualRequired: number;
    removed: number;
    bySource: Record<string, number>;
    confidenceBuckets: Record<string, number>;
  };
  const newPerDestinationStats = (): PerDestinationStats => ({
    synced: 0,
    alreadySynced: 0,
    notFound: 0,
    manualRequired: 0,
    removed: 0,
    bySource: {},
    confidenceBuckets: {
      "0.65-0.72": 0,
      "0.72-0.82": 0,
      "0.82-0.90": 0,
      "0.90-1.00": 0,
    },
  });
  const stats = {
    synced: 0,
    alreadySynced: 0,
    notFound: 0,
    manualRequired: 0,
    removed: 0,
    bySource: {} as Record<string, number>,
    confidenceBuckets: {
      "0.65-0.72": 0,
      "0.72-0.82": 0,
      "0.82-0.90": 0,
      "0.90-1.00": 0,
    } as Record<string, number>,
    byDestination: {} as Record<string, PerDestinationStats>,
  };
  const destKey = (destination: { service: string; playlistId: string }) =>
    `${destination.service}:${destination.playlistId}`;
  const getDestStats = (destination: { service: string; playlistId: string }): PerDestinationStats => {
    const key = destKey(destination);
    let perDest = stats.byDestination[key];
    if (!perDest) {
      perDest = newPerDestinationStats();
      stats.byDestination[key] = perDest;
    }
    return perDest;
  };
  const recordSource = (source: string | undefined, destination?: { service: string; playlistId: string }) => {
    const key = source || "unknown";
    stats.bySource[key] = (stats.bySource[key] || 0) + 1;
    if (destination) {
      const perDest = getDestStats(destination);
      perDest.bySource[key] = (perDest.bySource[key] || 0) + 1;
    }
  };
  const bucketOf = (confidence: number): string | null => {
    if (confidence >= 0.9) return "0.90-1.00";
    if (confidence >= 0.82) return "0.82-0.90";
    if (confidence >= 0.72) return "0.72-0.82";
    if (confidence >= 0.65) return "0.65-0.72";
    return null;
  };
  const recordConfidence = (confidence: number, destination?: { service: string; playlistId: string }) => {
    const bucket = bucketOf(confidence);
    if (!bucket) return;
    stats.confidenceBuckets[bucket] += 1;
    if (destination) {
      const perDest = getDestStats(destination);
      perDest.confidenceBuckets[bucket] += 1;
    }
  };
  const recordOutcome = (
    destination: { service: string; playlistId: string },
    field: "synced" | "alreadySynced" | "notFound" | "manualRequired" | "removed",
  ) => {
    stats[field] += 1;
    getDestStats(destination)[field] += 1;
  };
  let deferredByBatchLimit = false;
  const sourcePlaylist = await getDestinationPlaylist(rule.sourceService, rule.sourcePlaylistId);
  if (!sourcePlaylist) {
    throw new Error(
      `Source playlist ${rule.sourceService}:${rule.sourcePlaylistId} is not cached in DB; refresh playlists list before running sync.`,
    );
  }
  const cachedSourceTracks = !refreshSourceTracks ? await getPlaylistTracksFromDb(sourcePlaylist.id) : [];
  const expectedSourceTracks = sourcePlaylist.trackCount ?? 0;
  const sourceCacheComplete = isReadComplete(cachedSourceTracks.length, expectedSourceTracks);
  let sourceTracks: NormalizedTrack[];
  if (sourceCacheComplete) {
    sourceTracks = cachedSourceTracks;
  } else {
    const sourceAdapter = getAdapter(rule.sourceService, rule.userId);
    const liveTracks = await sourceAdapter.getPlaylistTracks(rule.sourcePlaylistId);
    const expectedForLive = Math.max(expectedSourceTracks, cachedSourceTracks.length);
    if (!isReadComplete(liveTracks.length, expectedForLive)) {
      throw new PartialSourceReadError(liveTracks.length, expectedForLive);
    }
    const snapshotResult = await writePlaylistSnapshot(sourcePlaylist.id, liveTracks, {
      expectedCount: expectedForLive,
    });
    if (!snapshotResult.stored) {
      throw new PartialSourceReadError(liveTracks.length, expectedForLive);
    }
    sourceTracks = liveTracks;
  }
  const sourceGroupMember = sourcePlaylist
    ? await prisma.playlistGroupMember.findUnique({ where: { playlistId: sourcePlaylist.id } })
    : null;
  const groupId = sourceGroupMember?.groupId;
  const sourceExcludedTrackIds = new Set(
    groupId && sourcePlaylist
      ? (
          await prisma.excludedTrack.findMany({
            where: { groupId, playlistId: sourcePlaylist.id },
            select: { serviceTrackId: true },
          })
        ).map((item) => item.serviceTrackId)
      : [],
  );
  const overrides = groupId
    ? await prisma.trackOverride.findMany({
        where: { groupId },
      })
    : [];
  const overrideBySourceAndService = new Map(overrides.map((item) => [`${item.sourceTrackId}:${item.targetService}`, item.targetTrackId]));
  const overrideTrackRows = overrides.length
    ? await prisma.serviceTrack.findMany({
        where: { id: { in: Array.from(new Set(overrides.map((item) => item.targetTrackId))) } },
      })
    : [];
  const overrideTrackById = new Map(overrideTrackRows.map((track) => [track.id, track]));
  const serviceExclusions = groupId
    ? await prisma.syncTrackExclusion.findMany({
        where: { groupId },
      })
    : [];
  const excludedSourceAndService = new Set(serviceExclusions.map((item) => `${item.sourceTrackId}:${item.targetService}`));

  let wallClockTimer: ReturnType<typeof setTimeout> | null = null;
  const wallClockPromise = new Promise<never>((_, reject) => {
    wallClockTimer = setTimeout(() => {
      reject(new Error(`Sync job exceeded wall-clock timeout of ${SYNC_JOB_TIMEOUT_MS}ms`));
    }, SYNC_JOB_TIMEOUT_MS);
    (wallClockTimer as { unref?: () => void }).unref?.();
  });

  try {
    await Promise.race([wallClockPromise, Promise.all(rule.destinations.map(async (destination) => {
      throwIfActiveJobAborted();
      const targetKey = serviceKey(destination.service);
      const targetAdapter = getAdapter(destination.service, rule.userId);
      const destinationTracks = await targetAdapter.getPlaylistTracks(destination.playlistId);
      const destinationPlaylist = await getDestinationPlaylist(destination.service, destination.playlistId);
      if (destinationPlaylist && !destinationPlaylist.isWritable) {
        return;
      }
      const destinationExcludedTrackIds = new Set(
        groupId && destinationPlaylist
          ? (
              await prisma.excludedTrack.findMany({
                where: { groupId, playlistId: destinationPlaylist.id },
                select: { serviceTrackId: true },
              })
            ).map((item) => item.serviceTrackId)
          : [],
      );
      const sourceIds = new Set(sourceTracks.map((track) => track.isrc || track.sourceTrackId));
      const previouslyLoggedTitles = await getPreviouslyLoggedTitles(syncRuleId, destination.service, destination.playlistId);
      const maxTracksThisRun = boundedTrackCount();

      const candidatesForThisRun = sourceTracks.filter((track) => !previouslyLoggedTitles.has(track.title));
      const pendingSourceTracks =
        maxTracksThisRun > 0 ? candidatesForThisRun.slice(0, maxTracksThisRun) : candidatesForThisRun;
      if (maxTracksThisRun > 0 && candidatesForThisRun.length > pendingSourceTracks.length) {
        deferredByBatchLimit = true;
      }
      const sourceServiceTrackById = await bulkUpsertServiceTracks(pendingSourceTracks);
      const internalTrackIds = Array.from(
        new Set(Array.from(sourceServiceTrackById.values()).map((track) => track.internalTrackId)),
      );

      // Tracks that already have a PENDING manual-review candidate for this
      // destination service. Re-searching them every run is pure waste: the
      // candidate is upserted via a natural key so the second insert is a
      // no-op, but we still spin up SC browser subprocesses and burn rate
      // budget. Once the user accepts/skips via /manual-match the candidate
      // status flips to ACCEPTED/REJECTED and the normal stored-match /
      // rejected_candidate paths take over.
      const pendingReviewSourceTrackIds = new Set(
        sourceServiceTrackById.size
          ? (
              await prisma.manualMatchCandidate.findMany({
                where: {
                  userId: rule.userId,
                  status: "PENDING",
                  targetService: destination.service,
                  sourceServiceTrackId: { in: Array.from(sourceServiceTrackById.values()).map((t) => t.id) },
                },
                select: { sourceServiceTrackId: true },
              })
            ).map((row) => row.sourceServiceTrackId)
          : [],
      );

      const [matchContext, localCatalogPool] = await Promise.all([
        buildMatchContext({
          internalTrackIds,
          sourceTracks: pendingSourceTracks,
          targetService: destination.service,
          destinationTracks,
          sourceService: rule.sourceService,
          userId: rule.userId,
        }),
        prewarmLocalCatalog(pendingSourceTracks, targetKey).catch(() => new Map() as LocalCatalogPool),
      ]);

      const searchNeeded: Array<{ sourceTrack: NormalizedTrack; sourceKey: string; internalTrackId: string }> = [];
      for (const sourceTrack of pendingSourceTracks) {
        throwIfActiveJobAborted();
        const sourceKey = `${sourceTrack.sourceService}::${sourceTrack.sourceTrackId}`;
        const sourceServiceTrack = sourceServiceTrackById.get(sourceKey);
        if (!sourceServiceTrack) continue;
        if (sourceExcludedTrackIds.has(sourceServiceTrack.id)) continue;
        if (excludedSourceAndService.has(`${sourceServiceTrack.id}:${destination.service}`)) continue;
        if (overrideBySourceAndService.has(`${sourceServiceTrack.id}:${destination.service}`)) continue;
        if (lookupExistingInPlaylist(matchContext, sourceTrack)) continue;
        if (lookupStoredMatch(matchContext, sourceServiceTrack.internalTrackId)) continue;
        if (lookupIsrcMatch(matchContext, sourceTrack)) continue;
        if (pendingReviewSourceTrackIds.has(sourceServiceTrack.id)) continue;
        searchNeeded.push({ sourceTrack, sourceKey, internalTrackId: sourceServiceTrack.internalTrackId });
      }

      const searchResults = await mapWithConcurrency(searchNeeded, MATCH_CONCURRENCY, async (item) =>
        findMatch(item.sourceTrack, targetKey, targetAdapter, {
          skipIsrcDb: true,
          internalTrackId: item.internalTrackId,
          localCatalogPool,
        }).catch(() => null),
      );
      const precomputedMatches = new Map<string, Awaited<ReturnType<typeof findMatch>>>();
      for (let i = 0; i < searchNeeded.length; i++) {
        throwIfActiveJobAborted();
        precomputedMatches.set(searchNeeded[i].sourceKey, searchResults[i]);
      }

      const targetTracksToUpsert: NormalizedTrack[] = [];
      const seenTargetKeys = new Set<string>();
      const pushTargetTrack = (track: NormalizedTrack) => {
        const key = `${track.sourceService}::${track.sourceTrackId}`;
        if (seenTargetKeys.has(key)) return;
        seenTargetKeys.add(key);
        targetTracksToUpsert.push(track);
      };
      for (const sourceTrack of pendingSourceTracks) {
        throwIfActiveJobAborted();
        const sk = `${sourceTrack.sourceService}::${sourceTrack.sourceTrackId}`;
        const sst = sourceServiceTrackById.get(sk);
        if (!sst) continue;
        const overrideTrackId = overrideBySourceAndService.get(`${sst.id}:${destination.service}`);
        const existing = lookupExistingInPlaylist(matchContext, sourceTrack);
        const storedMatch = lookupStoredMatch(matchContext, sst.internalTrackId);
        const isrcDbMatch = lookupIsrcMatch(matchContext, sourceTrack);
        if (overrideTrackId) continue;
        if (existing) {
          pushTargetTrack(existing);
        } else if (storedMatch) {
          pushTargetTrack(storedMatch.track);
        } else if (isrcDbMatch) {
          pushTargetTrack(isrcDbMatch);
        } else {
          const m = precomputedMatches.get(sk);
          if (m) {
            pushTargetTrack(m.track);
            for (const c of (m.candidates ?? []).slice(0, 5)) pushTargetTrack(c.track);
          }
        }
      }
      const targetServiceTrackByKey = targetTracksToUpsert.length
        ? await bulkUpsertServiceTracks(targetTracksToUpsert)
        : new Map<string, Awaited<ReturnType<typeof bulkUpsertServiceTracks>> extends Map<string, infer V> ? V : never>();
      const destinationStateByServiceTrackId = new Map(
        destinationPlaylist && targetServiceTrackByKey.size
          ? (
              await prisma.playlistTrackState.findMany({
                where: {
                  playlistId: destinationPlaylist.id,
                  serviceTrackId: { in: Array.from(targetServiceTrackByKey.values()).map((track) => track.id) },
                  removedAt: null,
                },
              })
            ).map((state) => [state.serviceTrackId, state])
          : [],
      );
      const getTargetServiceTrack = async (track: NormalizedTrack) => {
        const key = `${track.sourceService}::${track.sourceTrackId}`;
        return targetServiceTrackByKey.get(key) ?? (await upsertServiceTrack(track));
      };

      const pendingLogs: Prisma.SyncLogCreateManyInput[] = [];
      // Flush logs in small batches so a mid-run crash still leaves
      // breadcrumbs in SyncLog instead of an empty job. Same idea for
      // SyncJob.statsJson — without periodic checkpoints, a worker killed
      // after 7 minutes of a 10-minute run shows "0 / 0" stats forever.
      const flushLogs = async () => {
        if (!pendingLogs.length) return;
        const batch = pendingLogs.splice(0);
        await prisma.syncLog.createMany({ data: batch }).catch((error) => {
          log.warn("flush logs failed", {
            jobId: job.id,
            batch: batch.length,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      };
      let lastStatsCheckpointAt = Date.now();
      const checkpointStats = async () => {
        if (Date.now() - lastStatsCheckpointAt < 30_000) return;
        lastStatsCheckpointAt = Date.now();
        // Two things in one round-trip: write our latest stats AND read
        // back the row so we notice if a user clicked Cancel via the API.
        // When the engine and the cancel route live in different processes
        // (Vercel function vs the worker), this DB poll is the only way
        // the engine knows the user wants to stop.
        const fresh = await prisma.syncJob
          .update({
            where: { id: job.id },
            data: { statsJson: JSON.stringify(stats) },
            select: { status: true },
          })
          .catch(() => null);
        if (fresh?.status === "CANCELLED") {
          throw new CancelledError("Sync cancelled by user");
        }
      };

      try {
      for (const sourceTrack of pendingSourceTracks) {
        throwIfActiveJobAborted();
        const sourceKey = `${sourceTrack.sourceService}::${sourceTrack.sourceTrackId}`;
        const sourceServiceTrack = sourceServiceTrackById.get(sourceKey);
        if (!sourceServiceTrack) continue;
        if (sourceExcludedTrackIds.has(sourceServiceTrack.id)) continue;
        if (excludedSourceAndService.has(`${sourceServiceTrack.id}:${destination.service}`)) continue;

        // Track already awaits a user decision on /manual-match. Skip the
        // search and re-stats it as manualRequired so the dashboard reflects
        // the carry-over without spawning another SC search subprocess.
        if (pendingReviewSourceTrackIds.has(sourceServiceTrack.id)) {
          recordSource("pending_review", destination);
          recordOutcome(destination, "manualRequired");
          continue;
        }

        const overrideTrackId = overrideBySourceAndService.get(`${sourceServiceTrack.id}:${destination.service}`);
        const overrideTrack = overrideTrackId ? overrideTrackById.get(overrideTrackId) ?? null : null;
        const existing = lookupExistingInPlaylist(matchContext, sourceTrack);
        const storedMatch = lookupStoredMatch(matchContext, sourceServiceTrack.internalTrackId);
        const isrcDbMatch = lookupIsrcMatch(matchContext, sourceTrack);

        let match: { track: NormalizedTrack; confidence: number; source?: string; candidates?: { track: NormalizedTrack; confidence: number }[] } | null;
        if (overrideTrack) {
          match = { track: normalizedFromServiceTrack(overrideTrack), confidence: 1, source: "manual_override" };
        } else if (existing) {
          match = { track: existing, confidence: 0.95, source: "playlist" };
        } else if (storedMatch) {
          match = { track: storedMatch.track, confidence: storedMatch.confidence, source: "stored" };
        } else if (isrcDbMatch) {
          match = { track: isrcDbMatch, confidence: 1, source: "isrc_db" };
        } else {
          match = precomputedMatches.get(sourceKey) ?? null;
        }

        if (match && match.confidence >= AUTO_MATCH_THRESHOLD) {
          recordSource(match.source, destination);
          recordConfidence(match.confidence, destination);
          const targetServiceTrack = await getTargetServiceTrack(match.track);
          await upsertAutoTrackMatch({
            internalTrackId: sourceServiceTrack.internalTrackId,
            sourceService: rule.sourceService,
            destinationService: destination.service,
            sourceServiceTrackId: sourceServiceTrack.id,
            targetServiceTrackId: targetServiceTrack.id,
            confidence: match.confidence,
          });

          const state = destinationStateByServiceTrackId.get(targetServiceTrack.id) ?? null;
          if (destinationExcludedTrackIds.has(targetServiceTrack.id)) {
            continue;
          }
          const alreadyPresent = Boolean(existing || state);

          if (!alreadyPresent) {
            throwIfActiveJobAborted();
            await writeThrottle(destination.service);
            throwIfActiveJobAborted();
            await targetAdapter.addTrackToPlaylist(destination.playlistId, match.track);
            destinationTracks.push(match.track);
          }
          if (destinationPlaylist) {
            const updatedState = await markPlaylistTrackPresent(
              destinationPlaylist.id,
              targetServiceTrack.id,
              !alreadyPresent,
              state,
            );
            destinationStateByServiceTrackId.set(targetServiceTrack.id, updatedState);
            if (!alreadyPresent) {
              const activeDestinationTrackCount = await prisma.playlistTrackState.count({
                where: { playlistId: destinationPlaylist.id, removedAt: null },
              });
              await prisma.playlist.update({
                where: { id: destinationPlaylist.id },
                data: { trackCount: activeDestinationTrackCount, lastFetchedAt: new Date() },
              });
            }
          }

          const action = alreadyPresent ? "already_synced" : "synced";
          recordOutcome(destination, alreadyPresent ? "alreadySynced" : "synced");

          pendingLogs.push({
            syncJobId: job.id,
            level: "INFO",
            action,
            service: destination.service,
            playlistId: destination.playlistId,
            trackTitle: sourceTrack.title,
            message: alreadyPresent
              ? `Already present with ${(match.confidence * 100).toFixed(0)}% confidence`
              : `Added with ${(match.confidence * 100).toFixed(0)}% confidence`,
            metadataJson: JSON.stringify({
              confidence: match.confidence,
              alreadyPresent,
              matchSource: match.source ?? "search",
              topConfidence: match.candidates?.[0]?.confidence,
              secondConfidence: match.candidates?.[1]?.confidence,
              candidateCount: match.candidates?.length ?? 0,
              scoreBreakdown: match.candidates?.[0] && "breakdown" in match.candidates[0]
                ? match.candidates[0].breakdown
                : undefined,
              gap:
                match.candidates && match.candidates.length >= 2
                  ? match.candidates[0].confidence - match.candidates[1].confidence
                  : undefined,
            }),
          });
        } else if (match && match.confidence >= MANUAL_REVIEW_THRESHOLD) {
          recordSource(`${match.source ?? "search"}_manual`, destination);
          recordConfidence(match.confidence, destination);
          const ranked = ("candidates" in match && match.candidates?.length ? match.candidates : [match]).slice(0, 5);
          const alternativeTracks = await Promise.all(
            ranked.map(async (candidate) => ({
              serviceTrack: await getTargetServiceTrack(candidate.track),
              confidence: candidate.confidence,
              breakdown: "breakdown" in candidate ? candidate.breakdown : undefined,
            })),
          );
          const targetServiceTrack = alternativeTracks[0]?.serviceTrack || (await getTargetServiceTrack(match.track));
          const manualCandidate = await upsertManualCandidate({
            userId: rule.userId,
            sourceServiceTrackId: sourceServiceTrack.id,
            targetService: destination.service,
            candidateServiceTrackId: targetServiceTrack.id,
            confidence: match.confidence,
            alternatives: alternativeTracks.map((candidate) => ({
              serviceTrackId: candidate.serviceTrack.id,
              confidence: candidate.confidence,
              breakdown: candidate.breakdown,
            })),
          });
          if (manualCandidate.status === "REJECTED") {
            recordOutcome(destination, "notFound");
            pendingLogs.push({
              syncJobId: job.id,
              level: "WARNING",
              action: "rejected_candidate",
              service: destination.service,
              playlistId: destination.playlistId,
              trackTitle: sourceTrack.title,
              message: "Previously rejected candidate was skipped",
              metadataJson: JSON.stringify({ confidence: match.confidence, candidateId: manualCandidate.candidate.id }),
            });
            continue;
          }

          recordOutcome(destination, "manualRequired");
          pendingLogs.push({
            syncJobId: job.id,
            level: "WARNING",
            action: "manual_required",
            service: destination.service,
            playlistId: destination.playlistId,
            trackTitle: sourceTrack.title,
            message: `Manual review required at ${(match.confidence * 100).toFixed(0)}% confidence`,
            metadataJson: JSON.stringify({
              confidence: match.confidence,
              matchSource: match.source ?? "search",
              topConfidence: match.candidates?.[0]?.confidence,
              secondConfidence: match.candidates?.[1]?.confidence,
              candidateCount: match.candidates?.length ?? 0,
              scoreBreakdown: match.candidates?.[0] && "breakdown" in match.candidates[0]
                ? match.candidates[0].breakdown
                : undefined,
            }),
          });
        } else {
          recordSource(match ? `${match.source ?? "search"}_low_confidence` : "no_match", destination);
          recordOutcome(destination, "notFound");
          pendingLogs.push({
            syncJobId: job.id,
            level: "WARNING",
            action: "not_found",
            service: destination.service,
            playlistId: destination.playlistId,
            trackTitle: sourceTrack.title,
            message: "No reliable match found",
            metadataJson: JSON.stringify({ confidence: match?.confidence || 0 }),
          });
        }

        if (pendingLogs.length >= 20) await flushLogs();
        await checkpointStats();
      }

      if (rule.mode === "ADD_AND_REMOVE") {
        const removable = destinationTracks.filter((track) => !sourceIds.has(track.isrc || track.sourceTrackId));
        const removableTracksToUpsert = removable.map((track) => ({ ...track, sourceService: targetKey as ServiceKey }));
        const removableServiceTrackByKey = removableTracksToUpsert.length
          ? await bulkUpsertServiceTracks(removableTracksToUpsert)
          : new Map<string, ServiceTrack>();
        const removableServiceTrackIds = Array.from(removableServiceTrackByKey.values())
          .map((track) => track.id)
          .filter((id) => !destinationExcludedTrackIds.has(id));
        const removableStateByServiceTrackId = new Map(
          destinationPlaylist && removableServiceTrackIds.length
            ? (
                await prisma.playlistTrackState.findMany({
                  where: {
                    playlistId: destinationPlaylist.id,
                    serviceTrackId: { in: removableServiceTrackIds },
                    addedBySystem: true,
                    removedAt: null,
                  },
                })
              ).map((state) => [state.serviceTrackId, state])
            : [],
        );
        for (const track of removable) {
          throwIfActiveJobAborted();
          const serviceTrackKey = `${targetKey}::${track.sourceTrackId}`;
          const serviceTrack = removableServiceTrackByKey.get(serviceTrackKey);
          if (!serviceTrack) {
            throw new Error(`bulkUpsertServiceTracks did not return entry for ${serviceTrackKey}`);
          }
          if (destinationExcludedTrackIds.has(serviceTrack.id)) {
            continue;
          }
          const state = removableStateByServiceTrackId.get(serviceTrack.id);
          if (state) {
            throwIfActiveJobAborted();
            await writeThrottle(destination.service);
            throwIfActiveJobAborted();
            await targetAdapter.removeTrackFromPlaylist(destination.playlistId, track.sourceTrackId);
            await prisma.playlistTrackState.update({
              where: { id: state.id },
              data: { removedAt: new Date(), lastSeenAt: new Date() },
            });
            recordOutcome(destination, "removed");
            pendingLogs.push({
              syncJobId: job.id,
              level: "INFO",
              action: "removed",
              service: destination.service,
              playlistId: destination.playlistId,
              trackTitle: track.title,
              message: "Removed system-added track missing from source",
              metadataJson: JSON.stringify({ source: "ADD_AND_REMOVE" }),
            });
          }
        }
      }

      } finally {
        await flushLogs();
        // Force a final stats write so the dashboard reflects this
        // destination's outcome before runSync writes the summary row.
        lastStatsCheckpointAt = 0;
        await checkpointStats();
      }

      if (destinationPlaylist) {
        try {
          const refreshResult = await syncPlaylistTracksToDb(rule.userId, targetKey, destination.playlistId);
          if (refreshResult && "skipped" in refreshResult && refreshResult.skipped) {
            log.warn("destination snapshot refresh skipped", {
              jobId: job.id,
              destination: `${destination.service}:${destination.playlistId}`,
              reason: refreshResult.reason,
            });
          }
        } catch (refreshError) {
          log.warn("destination snapshot refresh failed", {
            jobId: job.id,
            destination: `${destination.service}:${destination.playlistId}`,
            error: refreshError instanceof Error ? refreshError.message : String(refreshError),
          });
        }
      }
    }))]);

    const status = stats.notFound || stats.manualRequired ? "PARTIAL_SUCCESS" : "SUCCESS";
    const finished = await prisma.syncJob.update({
      where: { id: job.id },
      data: { status, finishedAt: new Date(), statsJson: JSON.stringify(stats) },
    });
    await prisma.syncRule.update({
      where: { id: syncRuleId },
      data: {
        lastRunAt: new Date(),
        nextRunAt: deferredByBatchLimit ? null : nextScheduledRun(rule.intervalMinutes),
      },
    });
    await recordSuccessForRule([rule.sourceService, ...rule.destinations.map((destination) => destination.service)]).catch(() => {});
    return finished;
  } catch (error) {
    const isCancelled = error instanceof CancelledError;
    const errorKind = isCancelled ? "cancelled" : classifyError(error);
    const failed = await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        // Preserve the CANCELLED status the cancel route set — overwriting
        // it with FAILED would lose the distinction between "user stopped
        // it" and "it actually broke". The route already wrote
        // finishedAt + errorMessage, but rewriting them here keeps stats
        // consistent (we have a final stats snapshot to attach).
        status: isCancelled ? "CANCELLED" : "FAILED",
        finishedAt: new Date(),
        statsJson: JSON.stringify(stats),
        errorMessage: error instanceof Error ? error.message : "Unknown sync error",
        errorKind,
      },
    });
    await prisma.syncRule.update({
      where: { id: syncRuleId },
      data: {
        lastRunAt: new Date(),
        nextRunAt: nextRunAfterFailure(rule.intervalMinutes, error),
      },
    });
    const destServices = rule.destinations.map((destination) => destination.service);
    await recordCooldownForRule([rule.sourceService, ...destServices], error).catch(() => {});
    // Surface auth failures on the ConnectedAccount so the UI can show a
    // "re-login" prompt instead of leaving the user wondering why every
    // sync fails. Best-effort: don't let bookkeeping mask the real error.
    if (errorKind === "auth") {
      const affected = new Set([rule.sourceService, ...destServices]);
      for (const service of affected) {
        await prisma.connectedAccount
          .updateMany({
            where: { userId: rule.userId, service },
            data: {
              connectionStatus: "NEEDS_LOGIN",
              lastError: error instanceof Error ? error.message : String(error),
            },
          })
          .catch((dbError) => {
            // Don't let the bookkeeping write mask the real error returned
            // from runSync, but DO log it — otherwise a broken DB leaves
            // the user without the NEEDS_LOGIN prompt and no clue why.
            log.warn("failed to mark account NEEDS_LOGIN after auth error", {
              service,
              userId: rule.userId,
              error: dbError instanceof Error ? dbError.message : String(dbError),
            });
          });
      }
    }
    return failed;
  } finally {
    if (wallClockTimer) clearTimeout(wallClockTimer);
    const remainingPids = listKnownChildPids();
    if (remainingPids.length) {
      killChildPids(remainingPids);
    }
    bindCurrentJob(null);
    await closeAllPersistentRunners().catch(() => {});
    await releaseAllSessions().catch(() => {});
  }
}
