import type { ServiceTrack } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getAdapter, serviceKey } from "@/lib/services/adapterFactory";
import type { MusicServiceAdapter } from "@/lib/services/MusicServiceAdapter";
import {
  buildMatchContext,
  lookupExistingInPlaylist,
  lookupIsrcMatch,
  lookupStoredMatch,
  resolveInternalTrackId,
  bulkUpsertServiceTracks,
} from "@/lib/sync/matchContext";
import { findMatch, prewarmLocalCatalog } from "@/lib/sync/matchEngine";
import type { NormalizedTrack } from "@/lib/sync/syncTypes";

type Decision = {
  source: string;
  targetService: string;
  action:
    | "already_present"
    | "would_add"
    | "manual_review"
    | "not_found"
    | "skipped"
    | "override"
    | "excluded"
    | "previously_logged"
    | "deferred_batch_limit";
  confidence?: number;
  matchSource?: string;
  target?: string;
  reason?: string;
};

const makeNoSearchAdapter = (): MusicServiceAdapter => ({
  getCurrentUser: async () => ({ id: "dry-run", username: "dry-run" }),
  getPlaylists: async () => [],
  createPlaylist: async () => {
    throw new Error("dry-run adapter cannot create playlists");
  },
  getPlaylistTracks: async () => [],
  searchTrack: async () => [],
  addTrackToPlaylist: async () => {},
  removeTrackFromPlaylist: async () => {},
  refreshAccessToken: async () => ({ accessToken: "dry-run", refreshToken: "dry-run" }),
  isConnected: () => true,
});

const AUTO_MATCH_THRESHOLD = Number(process.env.WORKER_AUTO_MATCH_THRESHOLD ?? 0.82);
const MANUAL_REVIEW_THRESHOLD = Number(process.env.WORKER_MANUAL_REVIEW_THRESHOLD ?? 0.65);
const SOURCE_CACHE_TTL_HOURS = Math.max(0, Number(process.env.SYNC_DRY_SOURCE_CACHE_TTL_HOURS ?? 24));
const MAX_TRACKS_PER_RUN = Number(process.env.WORKER_MAX_TRACKS_PER_RUN ?? 10);
const SKIP_PREVIOUSLY_LOGGED = process.env.WORKER_SKIP_PREVIOUSLY_LOGGED !== "false";
const PREVIOUSLY_LOGGED_WINDOW_DAYS = Math.max(0, Number(process.env.WORKER_PREVIOUSLY_LOGGED_WINDOW_DAYS ?? 30));
const PARTIAL_TOLERANCE = Math.max(
  0,
  Math.min(0.5, Number(process.env.WORKER_SNAPSHOT_PARTIAL_TOLERANCE ?? 0.1)),
);

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function optionNumber(name: string, fallback: number): number {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function optionString(name: string): string | null {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || null;
}

function isReadComplete(received: number, expected: number): boolean {
  if (expected <= 0) return received > 0;
  if (received === 0) return false;
  return (expected - received) / expected <= PARTIAL_TOLERANCE;
}

function serviceTrackToNormalized(track: ServiceTrack): NormalizedTrack {
  return {
    title: track.title,
    artists: JSON.parse(track.artistsJson) as string[],
    album: track.album || undefined,
    durationMs: track.durationMs || undefined,
    isrc: track.isrc || undefined,
    sourceService: serviceKey(track.service),
    sourceTrackId: track.serviceTrackId,
    url: track.url || undefined,
    imageUrl: track.imageUrl || undefined,
  };
}

async function cachedPlaylistTracks(playlistId: string): Promise<NormalizedTrack[]> {
  const rows = await prisma.playlistTrackState.findMany({
    where: { playlistId, removedAt: null },
    orderBy: { position: "asc" },
    include: { serviceTrack: true },
  });
  return rows.map((row) => serviceTrackToNormalized(row.serviceTrack));
}

function cacheAgeHours(lastFetchedAt: Date | null): number | null {
  if (!lastFetchedAt) return null;
  return (Date.now() - lastFetchedAt.getTime()) / 3_600_000;
}

async function loadSourceTracks({
  userId,
  sourceService,
  sourcePlaylistId,
  forceRefresh,
}: {
  userId: string;
  sourceService: string;
  sourcePlaylistId: string;
  forceRefresh: boolean;
}): Promise<{
  tracks: NormalizedTrack[];
  source: "cache" | "live";
  warning?: string;
  partial?: boolean;
  expected?: number;
}> {
  const playlist = await prisma.playlist.findUnique({
    where: { service_servicePlaylistId: { service: sourceService, servicePlaylistId: sourcePlaylistId } },
  });
  if (playlist && !forceRefresh) {
    const cached = await cachedPlaylistTracks(playlist.id);
    const age = cacheAgeHours(playlist.lastFetchedAt);
    const complete = isReadComplete(cached.length, playlist.trackCount ?? 0);
    const fresh = SOURCE_CACHE_TTL_HOURS <= 0 || (age !== null && age <= SOURCE_CACHE_TTL_HOURS);
    if (complete && fresh) return { tracks: cached, source: "cache" };
    if (cached.length) {
      return {
        tracks: cached,
        source: "cache",
        warning: `source cache is incomplete/stale (${cached.length}/${playlist.trackCount}, lastFetched=${playlist.lastFetchedAt?.toISOString() || "never"}); use --refresh to force live read`,
      };
    }
  }

  const adapter = getAdapter(sourceService, userId);
  const live = await adapter.getPlaylistTracks(sourcePlaylistId);
  const expected = Math.max(playlist?.trackCount ?? 0, 0);
  const partial = !isReadComplete(live.length, expected);
  return {
    tracks: live,
    source: "live",
    expected,
    partial,
    warning: partial ? `live read partial: ${live.length}/${expected}` : undefined,
  };
}

async function loadDestinationTracks({
  userId,
  service,
  playlistId,
  forceRefresh,
}: {
  userId: string;
  service: string;
  playlistId: string;
  forceRefresh: boolean;
}): Promise<{ tracks: NormalizedTrack[]; source: "cache" | "live"; warning?: string }> {
  const playlist = await prisma.playlist.findUnique({
    where: { service_servicePlaylistId: { service, servicePlaylistId: playlistId } },
  });
  if (playlist && !forceRefresh) {
    const cached = await cachedPlaylistTracks(playlist.id);
    return {
      tracks: cached,
      source: "cache",
      warning: playlist.trackCount > 0 && cached.length < playlist.trackCount
        ? `destination cache is incomplete (${cached.length}/${playlist.trackCount}); use --refresh-destination to force live read`
        : undefined,
    };
  }

  const adapter = getAdapter(service, userId);
  return { tracks: await adapter.getPlaylistTracks(playlistId), source: "live" };
}

function title(track: NormalizedTrack): string {
  const artists = track.artists.length ? `${track.artists.join(", ")} - ` : "";
  return `${artists}${track.title}`;
}

function bucket(confidence: number): string {
  if (confidence >= 0.9) return "0.90-1.00";
  if (confidence >= 0.82) return "0.82-0.90";
  if (confidence >= 0.72) return "0.72-0.82";
  if (confidence >= 0.65) return "0.65-0.72";
  return "<0.65";
}

async function getPreviouslyLoggedTitles(syncRuleId: string, service: string, playlistId: string): Promise<Set<string>> {
  if (!SKIP_PREVIOUSLY_LOGGED) return new Set();
  const since = PREVIOUSLY_LOGGED_WINDOW_DAYS > 0
    ? new Date(Date.now() - PREVIOUSLY_LOGGED_WINDOW_DAYS * 24 * 60 * 60_000)
    : undefined;
  const logs = await prisma.syncLog.findMany({
    where: {
      service,
      playlistId,
      action: { in: ["synced", "already_synced", "rejected_candidate"] },
      syncJob: { syncRuleId },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: { trackTitle: true },
    distinct: ["trackTitle"],
  });
  return new Set(logs.map((log) => log.trackTitle));
}

async function main(): Promise<void> {
  const syncRuleId = process.argv[2];
  if (!syncRuleId) {
    throw new Error("Usage: npm run sync:dry -- <syncRuleId> [--refresh] [--max=10] [--search-live] [--search-max=N]");
  }

  const max = optionNumber("--max", MAX_TRACKS_PER_RUN > 0 ? Math.floor(MAX_TRACKS_PER_RUN) : 10);
  const searchMax = optionNumber("--search-max", Number.POSITIVE_INFINITY);
  const forceRefresh = flag("--refresh");
  const forceDestinationRefresh = flag("--refresh-destination");
  const searchLive = flag("--search-live");
  const failOnPartial = flag("--strict") || !flag("--allow-partial");
  const writeArtifact = optionString("--artifact");
  const rule = await prisma.syncRule.findUnique({
    where: { id: syncRuleId },
    include: { destinations: { where: { isEnabled: true } } },
  });
  if (!rule) throw new Error(`SyncRule not found: ${syncRuleId}`);
  if (!rule.destinations.length) throw new Error(`SyncRule has no enabled destinations: ${syncRuleId}`);

  const sourceLoad = await loadSourceTracks({
    userId: rule.userId,
    sourceService: rule.sourceService,
    sourcePlaylistId: rule.sourcePlaylistId,
    forceRefresh,
  });
  if (sourceLoad.warning) console.log(`[dry-run] ${sourceLoad.warning}`);
  if (sourceLoad.partial && failOnPartial) {
    throw new Error(
      `Source live read partial (${sourceLoad.tracks.length}/${sourceLoad.expected}); dry-run aborted. Pass --allow-partial to override.`,
    );
  }

  const sourcePlaylistRow = await prisma.playlist.findUnique({
    where: { service_servicePlaylistId: { service: rule.sourceService, servicePlaylistId: rule.sourcePlaylistId } },
  });
  const sourceGroupMember = sourcePlaylistRow
    ? await prisma.playlistGroupMember.findUnique({ where: { playlistId: sourcePlaylistRow.id } })
    : null;
  const groupId = sourceGroupMember?.groupId;
  const sourceExcludedSet = new Set(
    groupId && sourcePlaylistRow
      ? (
          await prisma.excludedTrack.findMany({
            where: { groupId, playlistId: sourcePlaylistRow.id },
            select: { serviceTrackId: true },
          })
        ).map((item) => item.serviceTrackId)
      : [],
  );
  const overrides = groupId
    ? await prisma.trackOverride.findMany({ where: { groupId } })
    : [];
  const overrideBySourceAndService = new Map(
    overrides.map((item) => [`${item.sourceTrackId}:${item.targetService}`, item.targetTrackId]),
  );
  const serviceExclusions = groupId
    ? await prisma.syncTrackExclusion.findMany({ where: { groupId } })
    : [];
  const excludedSourceAndService = new Set(
    serviceExclusions.map((item) => `${item.sourceTrackId}:${item.targetService}`),
  );

  const allSourceTracks = sourceLoad.tracks;
  const evaluated = allSourceTracks.slice(0, max);
  const deferred = allSourceTracks.length - evaluated.length;
  console.log(
    `[dry-run] Source ${rule.sourceService}:${rule.sourcePlaylistId} loaded ${allSourceTracks.length} tracks from ${sourceLoad.source}; evaluating ${evaluated.length}.`,
  );
  if (!searchLive) {
    console.log("[dry-run] External target search is disabled; pass --search-live to include live service search.");
  }
  if (Number.isFinite(searchMax)) {
    console.log(`[dry-run] External search cap: --search-max=${searchMax}.`);
  }

  const decisions: Decision[] = [];
  const confidenceBuckets: Record<string, number> = {};

  const sourceServiceTrackByKey = await bulkUpsertServiceTracks(evaluated);
  const internalIds = evaluated.map(
    (track) => sourceServiceTrackByKey.get(`${track.sourceService}::${track.sourceTrackId}`)?.internalTrackId,
  );
  const fallbackInternalIds = await Promise.all(
    evaluated.map((track, idx) => internalIds[idx] ?? resolveInternalTrackId(track)),
  );

  for (const destination of rule.destinations) {
    const targetKey = serviceKey(destination.service);
    const targetAdapter = searchLive ? getAdapter(destination.service, rule.userId) : makeNoSearchAdapter();
    const destinationLoad = await loadDestinationTracks({
      userId: rule.userId,
      service: destination.service,
      playlistId: destination.playlistId,
      forceRefresh: forceDestinationRefresh,
    });
    if (destinationLoad.warning) console.log(`[dry-run] ${destinationLoad.warning}`);
    console.log(
      `[dry-run] Destination ${destination.service}:${destination.playlistId} loaded ${destinationLoad.tracks.length} tracks from ${destinationLoad.source}.`,
    );
    const destinationTracks = destinationLoad.tracks;
    const destinationPlaylistRow = await prisma.playlist.findUnique({
      where: {
        service_servicePlaylistId: { service: destination.service, servicePlaylistId: destination.playlistId },
      },
    });
    const destinationExcludedSet = new Set(
      groupId && destinationPlaylistRow
        ? (
            await prisma.excludedTrack.findMany({
              where: { groupId, playlistId: destinationPlaylistRow.id },
              select: { serviceTrackId: true },
            })
          ).map((item) => item.serviceTrackId)
        : [],
    );
    const previouslyLogged = await getPreviouslyLoggedTitles(syncRuleId, destination.service, destination.playlistId);

    const context = await buildMatchContext({
      internalTrackIds: fallbackInternalIds,
      sourceTracks: evaluated,
      targetService: destination.service,
      destinationTracks,
      sourceService: rule.sourceService,
      userId: rule.userId,
    });
    const localCatalogPool = await prewarmLocalCatalog(evaluated, targetKey);

    let externalSearchUsed = 0;

    for (let index = 0; index < evaluated.length; index += 1) {
      const sourceTrack = evaluated[index];
      const sourceTitleText = title(sourceTrack);
      const sourceServiceTrack = sourceServiceTrackByKey.get(`${sourceTrack.sourceService}::${sourceTrack.sourceTrackId}`);

      if (previouslyLogged.has(sourceTrack.title)) {
        decisions.push({
          source: sourceTitleText,
          targetService: destination.service,
          action: "previously_logged",
        });
        continue;
      }

      if (sourceServiceTrack) {
        if (sourceExcludedSet.has(sourceServiceTrack.id)) {
          decisions.push({ source: sourceTitleText, targetService: destination.service, action: "excluded", reason: "source playlist excluded" });
          continue;
        }
        if (excludedSourceAndService.has(`${sourceServiceTrack.id}:${destination.service}`)) {
          decisions.push({ source: sourceTitleText, targetService: destination.service, action: "excluded", reason: "service-specific exclusion" });
          continue;
        }
        const overrideTargetId = overrideBySourceAndService.get(`${sourceServiceTrack.id}:${destination.service}`);
        if (overrideTargetId) {
          decisions.push({
            source: sourceTitleText,
            targetService: destination.service,
            action: "override",
            confidence: 1,
            matchSource: "manual_override",
            target: overrideTargetId,
          });
          continue;
        }
      }

      const existing = lookupExistingInPlaylist(context, sourceTrack);
      if (existing) {
        decisions.push({
          source: sourceTitleText,
          targetService: destination.service,
          action: "already_present",
          target: title(existing),
          matchSource: "destination_playlist",
        });
        continue;
      }

      const stored = lookupStoredMatch(context, fallbackInternalIds[index]);
      const isrc = lookupIsrcMatch(context, sourceTrack);
      const direct = stored?.track || isrc;
      if (direct) {
        const targetServiceTrackId = stored?.track ? sourceServiceTrack?.id : undefined;
        const confidence = stored ? stored.confidence : 0.98;
        confidenceBuckets[bucket(confidence)] = (confidenceBuckets[bucket(confidence)] || 0) + 1;
        decisions.push({
          source: sourceTitleText,
          targetService: destination.service,
          action: destinationExcludedSet.has(targetServiceTrackId ?? "") ? "excluded" : "would_add",
          confidence,
          matchSource: stored ? "stored_match" : "isrc_db",
          target: title(direct),
        });
        continue;
      }

      if (externalSearchUsed >= searchMax) {
        decisions.push({
          source: sourceTitleText,
          targetService: destination.service,
          action: "not_found",
          reason: `external search cap reached (--search-max=${searchMax})`,
        });
        continue;
      }
      externalSearchUsed += 1;

      const match = await findMatch(sourceTrack, targetKey, targetAdapter, {
        skipIsrcDb: true,
        localCatalogPool,
        skipExternalSearch: !searchLive,
      }).catch(() => null);

      if (!match) {
        decisions.push({
          source: sourceTitleText,
          targetService: destination.service,
          action: "not_found",
          reason: searchLive ? undefined : "needs_live_search",
        });
        continue;
      }
      confidenceBuckets[bucket(match.confidence)] = (confidenceBuckets[bucket(match.confidence)] || 0) + 1;
      if (match.confidence >= AUTO_MATCH_THRESHOLD) {
        decisions.push({
          source: sourceTitleText,
          targetService: destination.service,
          action: "would_add",
          confidence: match.confidence,
          matchSource: match.source,
          target: title(match.track),
        });
      } else if (match.confidence >= MANUAL_REVIEW_THRESHOLD) {
        decisions.push({
          source: sourceTitleText,
          targetService: destination.service,
          action: "manual_review",
          confidence: match.confidence,
          matchSource: match.source,
          target: title(match.track),
          reason: "below auto threshold",
        });
      } else {
        decisions.push({
          source: sourceTitleText,
          targetService: destination.service,
          action: "not_found",
          confidence: match.confidence,
          matchSource: match.source,
          target: title(match.track),
        });
      }
    }
  }

  if (deferred > 0) {
    decisions.push({
      source: `+${deferred} tracks`,
      targetService: "*",
      action: "deferred_batch_limit",
      reason: `--max=${max}, ${deferred} tracks deferred to next runs`,
    });
  }

  const counts = decisions.reduce<Record<string, number>>((acc, decision) => {
    acc[decision.action] = (acc[decision.action] || 0) + 1;
    return acc;
  }, {});
  const summary = { counts, confidenceBuckets, decisions };
  const payload = JSON.stringify(summary, null, 2);
  console.log(payload);
  if (writeArtifact) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const target = path.isAbsolute(writeArtifact)
      ? writeArtifact
      : path.join(
          process.cwd(),
          "worker",
          "state",
          writeArtifact || `dry-run-${syncRuleId}-${Date.now()}.json`,
        );
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, payload);
    console.log(`[dry-run] artifact saved: ${target}`);
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
