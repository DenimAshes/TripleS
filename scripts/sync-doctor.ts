import fs from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { getAdapter, serviceEnum, serviceKey } from "@/lib/services/adapterFactory";
import { getServicesInCooldown } from "@/lib/sync/serviceCooldown";
import { shouldRefreshSourceCache } from "@/lib/sync/sourceCachePolicy";
import type { ServiceKey } from "@/lib/sync/syncTypes";
import { stateFilePath } from "@/worker/config";

const PARTIAL_TOLERANCE = Math.max(
  0,
  Math.min(0.5, Number(process.env.WORKER_SNAPSHOT_PARTIAL_TOLERANCE ?? 0.1)),
);
const LIVE_READ_TIMEOUT_MS = Math.max(1, Number(process.env.SYNC_DOCTOR_LIVE_TIMEOUT_MS ?? 60_000));

function isReadComplete(received: number, expected: number): boolean {
  if (expected <= 0) return received > 0;
  if (received === 0) return false;
  return (expected - received) / expected <= PARTIAL_TOLERANCE;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      (timer as { unref?: () => void }).unref?.();
    }),
  ]);
}

type Status = "OK" | "WARN" | "FAIL";

type Check = {
  status: Status;
  name: string;
  detail: string;
};

const SOURCE_CACHE_TTL_HOURS = Math.max(0, Number(process.env.SYNC_DOCTOR_SOURCE_CACHE_TTL_HOURS ?? 24));

function print(checks: Check[]): void {
  for (const check of checks) {
    console.log(`[${check.status}] ${check.name}: ${check.detail}`);
  }
  const fail = checks.filter((check) => check.status === "FAIL").length;
  const warn = checks.filter((check) => check.status === "WARN").length;
  console.log(`\nSummary: ${fail} fail, ${warn} warn, ${checks.length - fail - warn} ok`);
  process.exitCode = fail ? 1 : 0;
}

function serviceNeedsState(service: string): boolean {
  const key = service.toLowerCase();
  if (key === "youtube") return process.env.YOUTUBE_BROWSER_AUTOMATION === "true";
  if (key === "soundcloud") return process.env.SOUNDCLOUD_BROWSER_AUTOMATION === "true";
  return false;
}

function cacheAgeHours(lastFetchedAt: Date | null): number | null {
  if (!lastFetchedAt) return null;
  return (Date.now() - lastFetchedAt.getTime()) / 3_600_000;
}

async function diagnoseRule(syncRuleId: string, liveMode: boolean): Promise<Check[]> {
  const rule = await prisma.syncRule.findUnique({
    where: { id: syncRuleId },
    include: { destinations: { where: { isEnabled: true } } },
  });
  if (!rule) throw new Error(`SyncRule not found: ${syncRuleId}`);

  const checks: Check[] = [];
  checks.push({
    status: rule.isEnabled ? "OK" : "WARN",
    name: "rule",
    detail: `${rule.name} (${rule.sourceService} -> ${rule.destinations.map((d) => d.service).join(", ") || "no destinations"})`,
  });

  const runningJob = await prisma.syncJob.findFirst({
    where: { syncRuleId, status: "RUNNING", finishedAt: null },
    orderBy: { startedAt: "desc" },
  });
  checks.push({
    status: runningJob ? "FAIL" : "OK",
    name: "running job",
    detail: runningJob ? `${runningJob.id} started ${runningJob.startedAt.toISOString()}` : "none",
  });

  const recentJobs = await prisma.syncJob.findMany({
    where: { syncRuleId },
    orderBy: { startedAt: "desc" },
    take: 3,
    select: { id: true, status: true, startedAt: true, finishedAt: true, errorMessage: true, statsJson: true },
  });
  checks.push({
    status: recentJobs.some((job) => job.status === "FAILED") ? "WARN" : "OK",
    name: "recent jobs",
    detail: recentJobs.length
      ? recentJobs.map((job) => `${job.status} ${job.startedAt.toISOString()}${job.errorMessage ? ` (${job.errorMessage})` : ""}`).join(" | ")
      : "no prior jobs",
  });

  const cooled = await getServicesInCooldown();
  const ruleServices = [rule.sourceService, ...rule.destinations.map((d) => d.service)];
  const cooledServices = ruleServices.map((service) => service.toLowerCase()).filter((service) => cooled.has(service));
  checks.push({
    status: cooledServices.length ? "FAIL" : "OK",
    name: "service cooldown",
    detail: cooledServices.length ? cooledServices.join(", ") : "none",
  });

  for (const service of ruleServices) {
    if (!serviceNeedsState(service)) continue;
    const path = stateFilePath(service.toLowerCase() as ServiceKey);
    checks.push({
      status: fs.existsSync(path) ? "OK" : "FAIL",
      name: `${service} browser state`,
      detail: path,
    });
  }

  const playlistRefs = [
    { service: rule.sourceService, servicePlaylistId: rule.sourcePlaylistId },
    ...rule.destinations.map((destination) => ({
      service: destination.service,
      servicePlaylistId: destination.playlistId,
    })),
  ];
  const playlists = await prisma.playlist.findMany({ where: { OR: playlistRefs } });
  const playlistByKey = new Map(playlists.map((playlist) => [`${playlist.service}::${playlist.servicePlaylistId}`, playlist]));
  const activeCounts = playlists.length
    ? await prisma.playlistTrackState.groupBy({
        by: ["playlistId"],
        where: { playlistId: { in: playlists.map((playlist) => playlist.id) }, removedAt: null },
        _count: { _all: true },
      })
    : [];
  const activeCountByPlaylistId = new Map(activeCounts.map((row) => [row.playlistId, row._count._all]));

  const sourcePlaylist = playlistByKey.get(`${rule.sourceService}::${rule.sourcePlaylistId}`);
  if (!sourcePlaylist) {
    checks.push({ status: "FAIL", name: "source playlist row", detail: `${rule.sourceService}:${rule.sourcePlaylistId} missing in DB` });
  } else {
    const states = activeCountByPlaylistId.get(sourcePlaylist.id) ?? 0;
    const age = cacheAgeHours(sourcePlaylist.lastFetchedAt);
    const complete = sourcePlaylist.trackCount <= 0 || states >= sourcePlaylist.trackCount;
    const fresh = SOURCE_CACHE_TTL_HOURS <= 0 || (age !== null && age <= SOURCE_CACHE_TTL_HOURS);
    const willRefreshLive = shouldRefreshSourceCache({ lastFetchedAt: sourcePlaylist.lastFetchedAt });
    checks.push({
      status: (complete && fresh) || willRefreshLive ? "OK" : "WARN",
      name: "source cache",
      detail:
        complete && fresh
          ? `${states}/${sourcePlaylist.trackCount} active tracks, lastFetched=${sourcePlaylist.lastFetchedAt?.toISOString() || "never"}`
          : `${states}/${sourcePlaylist.trackCount} active tracks, lastFetched=${sourcePlaylist.lastFetchedAt?.toISOString() || "never"}; worker will refresh live before syncing`,
    });
  }

  for (const destination of rule.destinations) {
    const playlist = playlistByKey.get(`${destination.service}::${destination.playlistId}`);
    if (!playlist) {
      checks.push({ status: "FAIL", name: `${destination.service} destination row`, detail: `${destination.playlistId} missing in DB` });
      continue;
    }
    const states = activeCountByPlaylistId.get(playlist.id) ?? 0;
    checks.push({
      status: playlist.isWritable ? "OK" : "FAIL",
      name: `${destination.service} destination`,
      detail: `${playlist.name}, writable=${playlist.isWritable}, cachedTracks=${states}/${playlist.trackCount}`,
    });
  }

  const sourceServiceTracks = sourcePlaylist
    ? await prisma.playlistTrackState.findMany({
        where: { playlistId: sourcePlaylist.id, removedAt: null },
        select: { serviceTrackId: true },
      })
    : [];
  const sourceTrackIds = sourceServiceTracks.map((state) => state.serviceTrackId);
  const pendingManual = sourceTrackIds.length
    ? await prisma.manualMatchCandidate.count({
        where: {
          sourceServiceTrackId: { in: sourceTrackIds },
          targetService: { in: rule.destinations.map((destination) => destination.service) },
          status: "PENDING",
        },
      })
    : 0;
  checks.push({
    status: pendingManual > 0 ? "WARN" : "OK",
    name: "pending manual matches",
    detail: `${pendingManual} pending for cached source tracks`,
  });

  if (liveMode) {
    if (sourcePlaylist) {
      try {
        const adapter = getAdapter(rule.sourceService, rule.userId);
        const live = await withTimeout(
          adapter.getPlaylistTracks(rule.sourcePlaylistId),
          LIVE_READ_TIMEOUT_MS,
          `${rule.sourceService} source live read`,
        );
        const expected = sourcePlaylist.trackCount ?? 0;
        checks.push({
          status: isReadComplete(live.length, expected) ? "OK" : "WARN",
          name: "source live read",
          detail: `${live.length}/${expected} tracks`,
        });
      } catch (error) {
        checks.push({
          status: "FAIL",
          name: "source live read",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const destination of rule.destinations) {
      const playlist = playlistByKey.get(`${destination.service}::${destination.playlistId}`);
      try {
        const adapter = getAdapter(destination.service, rule.userId);
        const live = await withTimeout(
          adapter.getPlaylistTracks(destination.playlistId),
          LIVE_READ_TIMEOUT_MS,
          `${destination.service} destination live read`,
        );
        const expected = playlist?.trackCount ?? 0;
        checks.push({
          status: expected > 0 && !isReadComplete(live.length, expected) ? "WARN" : "OK",
          name: `${destination.service} destination live read`,
          detail: `${live.length}/${expected} tracks`,
        });
      } catch (error) {
        checks.push({
          status: "FAIL",
          name: `${destination.service} destination live read`,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (sourcePlaylist) {
    const samples = await prisma.playlistTrackState.findMany({
      where: { playlistId: sourcePlaylist.id, removedAt: null },
      orderBy: { position: "asc" },
      take: 5,
      include: { serviceTrack: { select: { title: true, artistsJson: true } } },
    });
    if (samples.length) {
      checks.push({
        status: "OK",
        name: "source sample",
        detail: samples
          .map((sample) => `#${sample.position} ${sample.serviceTrack.title}`)
          .join(" | "),
      });
    }
  }

  const serviceTrackCount = await prisma.serviceTrack.count({
    where: { service: { in: rule.destinations.map((destination) => serviceEnum(serviceKey(destination.service))) } },
  });
  checks.push({
    status: serviceTrackCount > 0 ? "OK" : "WARN",
    name: "target local catalog",
    detail: `${serviceTrackCount} cached target service tracks`,
  });

  return checks;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--live");
  const syncRuleId = args[0];
  const liveMode = process.argv.includes("--live");

  if (syncRuleId) {
    print(await diagnoseRule(syncRuleId, liveMode));
    return;
  }

  const rules = await prisma.syncRule.findMany({
    where: { isEnabled: true },
    select: { id: true, name: true },
    orderBy: [{ nextRunAt: "asc" }, { updatedAt: "desc" }],
  });
  if (!rules.length) {
    print([{ status: "WARN", name: "enabled sync rules", detail: "none" }]);
    return;
  }

  const checks: Check[] = [];
  for (const rule of rules) {
    checks.push({ status: "OK", name: "sync rule", detail: `${rule.name} (${rule.id})` });
    checks.push(...(await diagnoseRule(rule.id, liveMode)));
  }
  print(checks);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
