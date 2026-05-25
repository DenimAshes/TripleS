import Link from "next/link";
import { Activity, ArrowRight, ListMusic } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ServiceIcon, serviceMeta } from "@/components/ServiceBrand";
import { PlaylistsAutoRefresh } from "@/components/PlaylistsAutoRefresh";
import { RunningJobsAutoRefresh } from "@/components/RunningJobsAutoRefresh";
import { ServiceCard } from "@/components/ServiceCard";
import { SessionStalenessBanner, classifySession, type SessionStaleness } from "@/components/SessionStalenessBanner";
import { SyncRuleCard } from "@/components/SyncRuleCard";
import { SyncRuleGroupCard } from "@/components/SyncRuleGroupCard";
import { StatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";

const WORKER_SERVICES = ["youtube", "spotify", "soundcloud"];

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
    const pendingRows = await prisma.$queryRaw<Array<{ playlistId: string; count: bigint }>>`
      SELECT pts."playlistId", COUNT(mmc."id") AS count
      FROM "PlaylistTrackState" pts
      JOIN "ManualMatchCandidate" mmc ON mmc."sourceServiceTrackId" = pts."serviceTrackId"
      WHERE pts."playlistId" IN (${Prisma.join(sourceIds)})
        AND pts."removedAt" IS NULL
        AND mmc."userId" = ${userId}
        AND mmc."status" = 'PENDING'
      GROUP BY pts."playlistId"
    `;
    for (const row of pendingRows) {
      pendingBySource.set(row.playlistId, Number(row.count));
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
  const [accounts, rules, lastJob, playlists, sessionRows, pendingReviewCount, runningJobs, recentJobs, groupMembers] = await Promise.all([
    prisma.connectedAccount.findMany({ where: { userId: session!.userId }, orderBy: { service: "asc" } }),
    prisma.syncRule.findMany({ where: { userId: session!.userId }, include: { destinations: true }, orderBy: { createdAt: "asc" } }),
    prisma.syncJob.findFirst({ where: { syncRule: { userId: session!.userId } }, orderBy: { startedAt: "desc" } }),
    prisma.playlist.findMany({ where: { userId: session!.userId }, select: { updatedAt: true } }),
    prisma.workerSessionState.findMany({ where: { service: { in: WORKER_SERVICES } } }),
    prisma.manualMatchCandidate.count({ where: { userId: session!.userId, status: "PENDING" } }),
    prisma.syncJob.findMany({
      where: { status: "RUNNING", syncRule: { userId: session!.userId } },
      select: { id: true, syncRuleId: true, startedAt: true },
      orderBy: { startedAt: "desc" },
    }),
    prisma.syncJob.findMany({
      where: { syncRule: { userId: session!.userId } },
      select: { id: true, syncRuleId: true, status: true, startedAt: true, finishedAt: true, errorMessage: true },
      orderBy: { startedAt: "desc" },
      take: 80,
    }),
    prisma.playlistGroupMember.findMany({
      where: { group: { userId: session!.userId } },
      include: {
        group: true,
        playlist: { select: { id: true, service: true, servicePlaylistId: true, name: true } },
      },
      orderBy: { service: "asc" },
    }),
  ]);
  const runningByRule = new Map(
    runningJobs.map((job) => [job.syncRuleId, { id: job.id, startedAt: job.startedAt.toISOString() }]),
  );
  const latestJobByRule = new Map<string, { id: string; status: string; startedAt: string; finishedAt: string | null; errorMessage: string | null }>();
  for (const job of recentJobs) {
    if (latestJobByRule.has(job.syncRuleId)) continue;
    latestJobByRule.set(job.syncRuleId, {
      id: job.id,
      status: job.status,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      errorMessage: job.errorMessage,
    });
  }

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
  const memberByPlaylistKey = new Map(
    groupMembers.map((member) => [`${member.playlist.service}:${member.playlist.servicePlaylistId}`, member]),
  );
  const groupedRules = new Map<string, RuleWithDestinations[]>();
  const standaloneRules: RuleWithDestinations[] = [];
  for (const rule of rules) {
    const member = memberByPlaylistKey.get(`${rule.sourceService}:${rule.sourcePlaylistId}`);
    if (rule.direction === "TWO_WAY" && member) {
      const rows = groupedRules.get(member.groupId) || [];
      rows.push(rule);
      groupedRules.set(member.groupId, rows);
    } else {
      standaloneRules.push(rule);
    }
  }
  const ruleGroups = Array.from(groupedRules.entries()).map(([groupId, groupRules]) => {
    const members = groupMembers.filter((member) => member.groupId === groupId);
    return {
      group: members[0]?.group,
      members: members.map((member) => ({
        id: member.id,
        service: member.playlist.service,
        name: member.playlist.name,
        servicePlaylistId: member.playlist.servicePlaylistId,
      })),
      rules: groupRules,
    };
  });

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
          <span className="text-xs font-semibold text-accent-fg uppercase tracking-wider">
            {ruleGroups.length + standaloneRules.length} item{ruleGroups.length + standaloneRules.length === 1 ? "" : "s"}
          </span>
        </div>
        {rules.length ? (
          <>
            {ruleGroups.map((item) =>
              item.group ? (
                <SyncRuleGroupCard
                  key={item.group.id}
                  groupName={item.group.name}
                  members={item.members}
                  rules={item.rules}
                  runningByRule={runningByRule}
                  progressByRule={ruleProgress}
                  latestJobByRule={latestJobByRule}
                />
              ) : null,
            )}
            {standaloneRules.map((rule) => (
              <SyncRuleCard
                key={rule.id}
                rule={rule}
                progress={ruleProgress.get(rule.id)}
                runningJob={runningByRule.get(rule.id) ?? null}
              />
            ))}
          </>
        ) : (
          <div className="panel p-8 text-center text-sm text-muted-fg">
            No sync rules yet. Open a playlist and pick a destination to connect them.
          </div>
        )}
      </section>

      <section className="mt-10 panel group surface-lift animated-gradient-frame animated-sheen relative overflow-hidden p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-70" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_at_15%_0%,rgba(79,141,255,0.08),transparent_52%)] opacity-60 transition duration-500 group-hover:opacity-100" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-fg">
              <Activity size={14} />
              Latest activity
            </div>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
              {lastJob
                ? lastJob.finishedAt?.toLocaleString() || lastJob.startedAt.toLocaleString()
                : "No runs yet"}
            </h2>
            <p className="mt-1 text-sm text-muted-fg">Outcome of the most recent sync run across your rules.</p>
          </div>
          <div className="flex items-center gap-2">
            {lastJob ? <StatusBadge status={lastJob.status.toLowerCase()} /> : null}
            <Link href="/history" className="btn btn-ghost surface-lift">
              History <ArrowRight size={14} />
            </Link>
          </div>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-4">
          <StatTile value={stats.synced} label="Added" tone="accent" />
          <StatTile value={stats.alreadySynced || 0} label="Already there" tone="neutral" />
          <StatTile value={stats.notFound} label="Not found" tone="danger" />
          <Link
            href="/manual-match"
            className={`panel-inset surface-lift animated-sheen group/tile relative overflow-hidden p-5 rounded-lg transition duration-200 hover:shadow-[0_18px_36px_-30px_var(--accent-glow)] ${
              pendingReviewCount > 0 ? "ring-1 ring-[var(--border-accent)]" : ""
            }`}
          >
            <div className="text-3xl font-black tracking-tight text-[#fcd34d]">{pendingReviewCount}</div>
            <div className="mt-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-fg">
              Review{stats.manualRequired ? ` · ${stats.manualRequired} last run` : ""}
              <ArrowRight size={11} className="ml-auto transition duration-200 group-hover/tile:translate-x-0.5" />
            </div>
          </Link>
        </div>
        {bySourceEntries.length ? (
          <div className="relative mt-6">
            <h3 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent-fg">
              <ListMusic size={13} /> Match sources
            </h3>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {bySourceEntries.map(([source, count]) => {
                const upper = source.toUpperCase();
                const known = upper === "SPOTIFY" || upper === "YOUTUBE" || upper === "SOUNDCLOUD";
                const meta = known ? serviceMeta(upper) : null;
                return (
                  <div
                    key={source}
                    className="surface-lift flex items-center justify-between gap-2 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2 transition hover:border-[var(--border)]"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {meta ? <ServiceIcon service={upper} size="sm" /> : null}
                      <span className="truncate text-xs text-muted-fg">{meta?.label ?? source}</span>
                    </div>
                    <div className="text-lg font-semibold tabular-nums text-white">{count}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

function StatTile({ value, label, tone }: { value: number; label: string; tone: "accent" | "neutral" | "danger" }) {
  const valueClass =
    tone === "accent" ? "text-[var(--accent)]" : tone === "danger" ? "text-[#fca5a5]" : "text-[var(--text)]";
  return (
    <div className="panel-inset surface-lift animated-sheen relative overflow-hidden p-5 rounded-lg">
      <div className={`text-3xl font-black tracking-tight ${valueClass}`}>{value}</div>
      <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-fg">{label}</div>
    </div>
  );
}
