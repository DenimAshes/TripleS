import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PlaylistsAutoRefresh } from "@/components/PlaylistsAutoRefresh";
import { ServiceCard } from "@/components/ServiceCard";
import { SessionStalenessBanner, classifySession, type SessionStaleness } from "@/components/SessionStalenessBanner";
import { SyncRuleCard } from "@/components/SyncRuleCard";
import { StatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

const WORKER_SERVICES = ["youtube", "spotify", "soundcloud"] as const;

type RuleWithDestinations = Awaited<ReturnType<typeof prisma.syncRule.findMany>>[number] & {
  destinations: Awaited<ReturnType<typeof prisma.syncDestination.findMany>>;
};

export type SyncRuleProgress = {
  sourceTotal: number;
  destinations: Array<{
    service: string;
    playlistId: string;
    playlistName?: string;
    synced: number;
    pendingReview: number;
  }>;
};

async function computeRuleProgress(
  userId: string,
  rules: RuleWithDestinations[],
): Promise<Map<string, SyncRuleProgress>> {
  const out = new Map<string, SyncRuleProgress>();
  if (!rules.length) return out;

  const keys = new Set<string>();
  const refs: Array<{ service: string; servicePlaylistId: string }> = [];
  for (const rule of rules) {
    for (const ref of [
      { service: rule.sourceService, servicePlaylistId: rule.sourcePlaylistId },
      ...rule.destinations.map((d) => ({ service: d.service, servicePlaylistId: d.playlistId })),
    ]) {
      const key = `${ref.service}::${ref.servicePlaylistId}`;
      if (keys.has(key)) continue;
      keys.add(key);
      refs.push(ref);
    }
  }
  const playlists = await prisma.playlist.findMany({
    where: {
      userId,
      OR: refs.map((ref) => ({ service: ref.service, servicePlaylistId: ref.servicePlaylistId })),
    },
    select: { id: true, service: true, servicePlaylistId: true, name: true, trackCount: true },
  });
  const playlistByKey = new Map(
    playlists.map((row) => [`${row.service}::${row.servicePlaylistId}`, row]),
  );

  const destPlaylistIds = rules.flatMap((rule) =>
    rule.destinations
      .map((d) => playlistByKey.get(`${d.service}::${d.playlistId}`)?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const stateCounts = destPlaylistIds.length
    ? await prisma.playlistTrackState.groupBy({
        by: ["playlistId"],
        where: { playlistId: { in: destPlaylistIds }, removedAt: null, addedBySystem: true },
        _count: { _all: true },
      })
    : [];
  const syncedByPlaylistId = new Map(stateCounts.map((row) => [row.playlistId, row._count._all]));

  // Pending review counts are per-source-playlist (a track from this playlist
  // got flagged for manual review). We attribute the same count to each
  // destination so cards show how many reviews block this rule's progress.
  const sourceIds = rules
    .map((rule) => playlistByKey.get(`${rule.sourceService}::${rule.sourcePlaylistId}`)?.id)
    .filter((id): id is string => Boolean(id));
  const pendingBySource = new Map<string, number>();
  if (sourceIds.length) {
    const stateByPlaylist = await prisma.playlistTrackState.findMany({
      where: { playlistId: { in: sourceIds }, removedAt: null },
      select: { playlistId: true, serviceTrackId: true },
    });
    const trackIdsByPlaylist = new Map<string, string[]>();
    for (const row of stateByPlaylist) {
      const list = trackIdsByPlaylist.get(row.playlistId) ?? [];
      list.push(row.serviceTrackId);
      trackIdsByPlaylist.set(row.playlistId, list);
    }
    for (const [playlistId, ids] of trackIdsByPlaylist) {
      if (!ids.length) continue;
      const count = await prisma.manualMatchCandidate.count({
        where: { userId, status: "PENDING", sourceServiceTrackId: { in: ids } },
      });
      pendingBySource.set(playlistId, count);
    }
  }

  for (const rule of rules) {
    const source = playlistByKey.get(`${rule.sourceService}::${rule.sourcePlaylistId}`);
    const pendingForRule = source ? pendingBySource.get(source.id) ?? 0 : 0;
    out.set(rule.id, {
      sourceTotal: source?.trackCount ?? 0,
      destinations: rule.destinations.map((d) => {
        const dest = playlistByKey.get(`${d.service}::${d.playlistId}`);
        return {
          service: d.service,
          playlistId: d.playlistId,
          playlistName: dest?.name,
          synced: dest ? syncedByPlaylistId.get(dest.id) ?? 0 : 0,
          pendingReview: pendingForRule,
        };
      }),
    });
  }
  return out;
}

export default async function DashboardPage() {
  const session = await getSession();
  const [accounts, rules, lastJob, playlists, sessionRows, pendingReviewCount] = await Promise.all([
    prisma.connectedAccount.findMany({ where: { userId: session!.userId }, orderBy: { service: "asc" } }),
    prisma.syncRule.findMany({ where: { userId: session!.userId }, include: { destinations: true }, orderBy: { createdAt: "asc" } }),
    prisma.syncJob.findFirst({ where: { syncRule: { userId: session!.userId } }, orderBy: { startedAt: "desc" } }),
    prisma.playlist.findMany({ where: { userId: session!.userId }, select: { updatedAt: true } }),
    prisma.workerSessionState.findMany({ where: { service: { in: WORKER_SERVICES as unknown as string[] } } }),
    prisma.manualMatchCandidate.count({ where: { userId: session!.userId, status: "PENDING" } }),
  ]);

  // Per-rule progress: how many tracks of the source playlist have already
  // been written into each destination. The sync engine bounds runs by
  // WORKER_MAX_TRACKS_PER_RUN, so a 58-track playlist can need many runs;
  // without this number on the card the user can't tell whether sync is
  // still working through it or finished.
  const ruleProgress = await computeRuleProgress(session!.userId, rules);
  const sessionByService = new Map(sessionRows.map((row) => [row.service, row]));
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const staleSessions: SessionStaleness[] = WORKER_SERVICES.flatMap((service) => {
    const row = sessionByService.get(service);
    const classified = classifySession({ service, exists: !!row, updatedAt: row?.updatedAt ?? null }, now);
    return classified ? [classified] : [];
  });
  const stats = lastJob ? JSON.parse(lastJob.statsJson) : { synced: 0, alreadySynced: 0, notFound: 0, manualRequired: 0 };
  const bySource: Record<string, number> = stats.bySource && typeof stats.bySource === "object" ? stats.bySource : {};
  const bySourceEntries = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  const lastChangedAt = playlists.reduce<Date | null>(
    (latest, playlist) => (!latest || playlist.updatedAt > latest ? playlist.updatedAt : latest),
    null,
  );

  return (
    <AppShell title="Home">
      <PlaylistsAutoRefresh hasPlaylists={playlists.length > 0} lastChangedAt={lastChangedAt?.toISOString() || null} />
      <SessionStalenessBanner items={staleSessions} />
      {pendingReviewCount > 0 ? (
        <Link
          href="/manual-match"
          className="panel mb-4 flex items-center justify-between gap-4 border-amber-300 bg-amber-50 p-4 transition hover:bg-amber-100"
        >
          <div>
            <div className="text-sm font-semibold text-amber-900">
              {pendingReviewCount} {pendingReviewCount === 1 ? "song needs" : "songs need"} your review
            </div>
            <div className="text-xs text-amber-800">
              Sync wasn&apos;t sure where to put them. Pick a match or skip.
            </div>
          </div>
          <span className="text-sm font-medium text-amber-900">Review now →</span>
        </Link>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        {["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"].map((service) => {
          const account = accounts.find((item) => item.service === service);
          return (
            <ServiceCard
              key={service}
              name={service}
              username={account?.serviceUsername}
              isMock={account?.isMock}
              connectionStatus={account?.connectionStatus}
              lastError={account?.lastError}
            />
          );
        })}
      </div>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">Playlist copies</h2>
        {rules.map((rule) => (
          <SyncRuleCard key={rule.id} rule={rule} progress={ruleProgress.get(rule.id)} />
        ))}
      </section>

      <section className="mt-6 panel p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Latest activity</h2>
            <p className="mt-1 text-sm text-[#666a73]">{lastJob ? lastJob.finishedAt?.toLocaleString() || lastJob.startedAt.toLocaleString() : "No activity yet"}</p>
          </div>
          {lastJob ? <StatusBadge status={lastJob.status.toLowerCase()} /> : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-md bg-[#f0f0ec] p-3"><div className="text-2xl font-semibold">{stats.synced}</div><div className="text-sm text-[#666a73]">added</div></div>
          <div className="rounded-md bg-[#f0f0ec] p-3"><div className="text-2xl font-semibold">{stats.alreadySynced || 0}</div><div className="text-sm text-[#666a73]">already there</div></div>
          <div className="rounded-md bg-[#f0f0ec] p-3"><div className="text-2xl font-semibold">{stats.notFound}</div><div className="text-sm text-[#666a73]">not found</div></div>
          <Link href="/manual-match" className="rounded-md bg-[#f0f0ec] p-3 transition hover:bg-[#e6e6e0]">
            <div className="text-2xl font-semibold">{pendingReviewCount}</div>
            <div className="text-sm text-[#666a73]">review {stats.manualRequired ? `(${stats.manualRequired} last run)` : ""}</div>
          </Link>
        </div>
        {bySourceEntries.length ? (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-[#666a73]">Match sources</h3>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {bySourceEntries.map(([source, count]) => (
                <div key={source} className="flex items-baseline justify-between rounded-md bg-[#f0f0ec] px-3 py-2">
                  <div className="text-xs text-[#666a73]">{source}</div>
                  <div className="text-lg font-semibold">{count}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
