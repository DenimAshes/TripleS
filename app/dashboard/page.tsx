import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PlaylistsAutoRefresh } from "@/components/PlaylistsAutoRefresh";
import { RunningJobsAutoRefresh } from "@/components/RunningJobsAutoRefresh";
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
    const allTrackIds = stateByPlaylist.map((row) => row.serviceTrackId);
    const candidates = allTrackIds.length
      ? await prisma.manualMatchCandidate.groupBy({
          by: ["sourceServiceTrackId"],
          where: { userId, status: "PENDING", sourceServiceTrackId: { in: allTrackIds } },
          _count: { _all: true },
        })
      : [];
    const pendingCountByTrack = new Map(candidates.map((row) => [row.sourceServiceTrackId, row._count._all]));
    for (const row of stateByPlaylist) {
      const n = pendingCountByTrack.get(row.serviceTrackId);
      if (!n) continue;
      pendingBySource.set(row.playlistId, (pendingBySource.get(row.playlistId) ?? 0) + n);
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
  const [accounts, rules, lastJob, playlists, sessionRows, pendingReviewCount, runningJobs] = await Promise.all([
    prisma.connectedAccount.findMany({ where: { userId: session!.userId }, orderBy: { service: "asc" } }),
    prisma.syncRule.findMany({ where: { userId: session!.userId }, include: { destinations: true }, orderBy: { createdAt: "asc" } }),
    prisma.syncJob.findFirst({ where: { syncRule: { userId: session!.userId } }, orderBy: { startedAt: "desc" } }),
    prisma.playlist.findMany({ where: { userId: session!.userId }, select: { updatedAt: true } }),
    prisma.workerSessionState.findMany({ where: { service: { in: WORKER_SERVICES as unknown as string[] } } }),
    prisma.manualMatchCandidate.count({ where: { userId: session!.userId, status: "PENDING" } }),
    prisma.syncJob.findMany({
      where: { status: "RUNNING", syncRule: { userId: session!.userId } },
      select: { id: true, syncRuleId: true, startedAt: true },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const runningByRule = new Map(
    runningJobs.map((job) => [job.syncRuleId, { id: job.id, startedAt: job.startedAt.toISOString() }]),
  );

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
    <AppShell title="Dashboard">
      <PlaylistsAutoRefresh hasPlaylists={playlists.length > 0} lastChangedAt={lastChangedAt?.toISOString() || null} />
      <RunningJobsAutoRefresh runningCount={runningJobs.length} />
      <SessionStalenessBanner items={staleSessions} />
      {pendingReviewCount > 0 ? (
        <Link
          href="/manual-match"
          className="panel-accent mb-8 flex items-center justify-between gap-4 p-6 transition duration-200 hover:shadow-[0_0_24px_rgba(79,141,255,0.15)]"
        >
          <div>
            <div className="text-base font-semibold text-[var(--text)]">
              {pendingReviewCount} {pendingReviewCount === 1 ? "song needs" : "songs need"} your review
            </div>
            <div className="mt-1 text-sm text-muted-fg">
              Sync wasn&apos;t sure where to put them. Pick a match or skip.
            </div>
          </div>
          <span className="text-base font-semibold text-[var(--accent)] whitespace-nowrap">Review now →</span>
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

      <section className="mt-10 space-y-4">
        <div className="flex items-baseline justify-between gap-4 px-1">
          <h2 className="text-2xl font-bold text-[var(--text)]">Playlist copies</h2>
          <span className="text-xs font-semibold text-accent-fg uppercase tracking-wider">{rules.length} rule{rules.length === 1 ? "" : "s"}</span>
        </div>
        {rules.length ? (
          rules.map((rule) => (
            <SyncRuleCard
              key={rule.id}
              rule={rule}
              progress={ruleProgress.get(rule.id)}
              runningJob={runningByRule.get(rule.id) ?? null}
            />
          ))
        ) : (
          <div className="panel p-8 text-center text-sm text-muted-fg">
            No sync rules yet. Open a playlist and pick a destination to connect them.
          </div>
        )}
      </section>

      <section className="mt-10 panel p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[var(--text)]">Latest activity</h2>
            <p className="mt-2 text-sm text-muted-fg">
              {lastJob
                ? lastJob.finishedAt?.toLocaleString() || lastJob.startedAt.toLocaleString()
                : "No activity yet"}
            </p>
          </div>
          {lastJob ? <StatusBadge status={lastJob.status.toLowerCase()} /> : null}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <div className="panel-inset p-5 rounded-lg">
            <div className="text-3xl font-bold text-[var(--accent)] tracking-tight">{stats.synced}</div>
            <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-fg">Added</div>
          </div>
          <div className="panel-inset p-5 rounded-lg">
            <div className="text-3xl font-bold text-[var(--text)] tracking-tight">{stats.alreadySynced || 0}</div>
            <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-fg">Already there</div>
          </div>
          <div className="panel-inset p-5 rounded-lg">
            <div className="text-3xl font-bold text-[#fca5a5] tracking-tight">{stats.notFound}</div>
            <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-fg">Not found</div>
          </div>
          <Link
            href="/manual-match"
            className={`panel-inset p-5 rounded-lg transition duration-200 hover:shadow-[0_0_12px_rgba(79,141,255,0.1)] ${
              pendingReviewCount > 0 ? "ring-1 ring-[var(--border-accent)]" : ""
            }`}
          >
            <div className="text-3xl font-bold text-[#fcd34d] tracking-tight">
              {pendingReviewCount}
            </div>
            <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-fg">
              Review{stats.manualRequired ? ` · ${stats.manualRequired} last run` : ""}
            </div>
          </Link>
        </div>
        {bySourceEntries.length ? (
          <div className="mt-6">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-accent-fg">
              Match sources
            </h3>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {bySourceEntries.map(([source, count]) => (
                <div
                  key={source}
                  className="flex items-baseline justify-between rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2"
                >
                  <div className="text-xs text-muted-fg">{source}</div>
                  <div className="text-lg font-semibold tabular-nums">{count}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
