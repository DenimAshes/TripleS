import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ListFilter, Radio, RotateCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SyncRunList, type SyncRunView } from "@/components/SyncRunList";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { parseSyncJobStats } from "@/lib/sync/syncJobStats";

const PAGE_SIZE = 8;
const NUMBER = new Intl.NumberFormat("en-GB");
const VIEWS = new Set(["all", "attention", "successful", "running"]);

function sourceKey(service: string, playlistId: string) {
  return `${service.toUpperCase()}:${playlistId}`;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string; run?: string }>;
}) {
  const session = await getSession();
  const params = await searchParams;
  const view = VIEWS.has(params.view || "") ? params.view! : "all";
  const page = Math.max(1, Number.parseInt(params.page || "1", 10) || 1);
  const status =
    view === "attention"
      ? { in: ["FAILED", "PARTIAL_SUCCESS"] }
      : view === "successful"
        ? "SUCCESS"
        : view === "running"
          ? "RUNNING"
          : undefined;
  const where = {
    syncRule: { userId: session!.userId },
    ...(status ? { status } : {}),
  };

  const [jobs, statusCounts, groups, playlists] = await Promise.all([
    prisma.syncJob.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        syncRule: { include: { destinations: { where: { isEnabled: true } } } },
        logs: { orderBy: { createdAt: "desc" }, take: 12 },
        _count: { select: { logs: true } },
      },
    }),
    prisma.syncJob.groupBy({
      by: ["status"],
      where: { syncRule: { userId: session!.userId } },
      _count: { _all: true },
    }),
    prisma.playlistGroup.findMany({
      where: { userId: session!.userId },
      include: { members: { include: { playlist: true } } },
    }),
    prisma.playlist.findMany({
      where: { userId: session!.userId },
      select: { id: true, service: true, servicePlaylistId: true, name: true },
    }),
  ]);

  const countByStatus = new Map(statusCounts.map((row) => [row.status, row._count._all]));
  const totalCount = statusCounts.reduce((sum, row) => sum + row._count._all, 0);
  const attentionCount = (countByStatus.get("FAILED") || 0) + (countByStatus.get("PARTIAL_SUCCESS") || 0);
  const successfulCount = countByStatus.get("SUCCESS") || 0;
  const runningCount = countByStatus.get("RUNNING") || 0;
  const shownTotal =
    view === "attention"
      ? attentionCount
      : view === "successful"
        ? successfulCount
        : view === "running"
          ? runningCount
          : totalCount;

  const playlistBySource = new Map(
    playlists.map((playlist) => [sourceKey(playlist.service, playlist.servicePlaylistId), playlist]),
  );
  const groupBySource = new Map<string, (typeof groups)[number]>();
  const memberKeysByGroup = new Map<string, Set<string>>();
  for (const group of groups) {
    const memberKeys = new Set<string>();
    for (const member of group.members) {
      const key = sourceKey(member.playlist.service, member.playlist.servicePlaylistId);
      groupBySource.set(key, group);
      memberKeys.add(key);
    }
    memberKeysByGroup.set(group.id, memberKeys);
  }

  // SyncJob is the durable unit. Several source jobs may belong to one worker
  // batch, but there is no persisted batch ID, so do not merge runs by time.
  const runs: SyncRunView[] = jobs.map((job) => {
    const rule = job.syncRule;
    const source = playlistBySource.get(sourceKey(rule.sourceService, rule.sourcePlaylistId));
    const candidateGroup = groupBySource.get(sourceKey(rule.sourceService, rule.sourcePlaylistId));
    const memberKeys = candidateGroup ? memberKeysByGroup.get(candidateGroup.id) : null;
    const staysInsideGroup = Boolean(
      memberKeys &&
        rule.destinations.length > 0 &&
        rule.destinations.every((destination) => memberKeys.has(sourceKey(destination.service, destination.playlistId))),
    );
    const group = candidateGroup && (rule.direction === "TWO_WAY" || staysInsideGroup) ? candidateGroup : null;

    return {
      id: job.id,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      errorKind: job.errorKind,
      errorMessage: job.errorMessage,
      ruleName: rule.name,
      groupId: group?.id || null,
      groupName: group?.name || null,
      sourceService: rule.sourceService,
      sourceName: source?.name || rule.name,
      destinations: rule.destinations.map((destination) => ({
        service: destination.service,
        name: playlistBySource.get(sourceKey(destination.service, destination.playlistId))?.name || destination.playlistId,
      })),
      stats: parseSyncJobStats(job.statsJson),
      logs: job.logs.map((log) => ({
        id: log.id,
        level: log.level,
        action: log.action,
        service: log.service,
        trackTitle: log.trackTitle,
        message: log.message,
      })),
      logCount: job._count.logs,
    };
  });

  const filters = [
    { value: "all", label: "All runs", count: totalCount, icon: <Radio size={13} /> },
    { value: "attention", label: "Needs attention", count: attentionCount, icon: <AlertTriangle size={13} /> },
    { value: "successful", label: "Successful", count: successfulCount, icon: <CheckCircle2 size={13} /> },
    { value: "running", label: "Running", count: runningCount, icon: <RotateCw size={13} /> },
  ];
  const firstShown = shownTotal ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastShown = Math.min(page * PAGE_SIZE, shownTotal);
  const hasNext = page * PAGE_SIZE < shownTotal;

  return (
    <AppShell
      title="Activity"
      description="One entry is one real synchronization run. Open it only when you need the song-level evidence."
      actions={params.run ? <Link href="/history" className="btn btn-ghost">All activity</Link> : undefined}
    >
      <section className="mb-6 border-y border-line-soft py-3" aria-label="Activity filters">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 px-1.5 text-xs text-muted-fg">
            <ListFilter size={12} /> Filter
          </div>
          {filters.map((filter) => {
            const active = view === filter.value;
            return (
              <Link
                key={filter.value}
                href={filter.value === "all" ? "/history" : `/history?view=${filter.value}`}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-2 text-sm transition-colors sm:min-h-0 sm:py-1 ${
                  active
                    ? "border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-accent-soft text-[var(--text)]"
                    : "border-line-soft bg-surface text-muted-fg hover:border-[var(--border)] hover:bg-surface-2 hover:text-[var(--text)]"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className={active ? "text-[var(--accent)]" : "text-dim-fg"}>{filter.icon}</span>
                {filter.label}
                <span className="rounded-[var(--radius-sm)] bg-surface-3 px-1.5 py-0.5 text-xs tabular-nums">{filter.count}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="heading-section">Sync runs</h2>
          <p className="mt-1 text-xs text-muted-fg">
            {shownTotal ? `Showing ${NUMBER.format(firstShown)}–${NUMBER.format(lastShown)} of ${NUMBER.format(shownTotal)}.` : "No runs match this filter."}
          </p>
        </div>
        {params.run ? <span className="pill pill-accent">Selected run opened</span> : null}
      </div>

      {runs.length ? (
        <SyncRunList runs={runs} selectedRunId={params.run} />
      ) : (
        <div className="workbench grid min-h-56 place-items-center p-6 text-center">
          <div>
            <Activity size={28} className="mx-auto text-dim-fg" />
            <h2 className="heading-panel mt-3">No sync runs here</h2>
            <p className="mt-1 text-sm text-muted-fg">
              {view === "all" ? "Run a playlist group to start its activity history." : "Choose another filter to see previous runs."}
            </p>
            {view !== "all" ? <Link href="/history" className="btn btn-ghost mt-4">Show all runs</Link> : null}
          </div>
        </div>
      )}

      {shownTotal > PAGE_SIZE ? (
        <nav className="mt-6 flex items-center justify-between gap-4 border-t border-line-soft pt-4" aria-label="Activity pages">
          {page > 1 ? (
            <Link href={activityHref(view, page - 1)} className="btn btn-ghost"><ChevronLeft size={15} /> Newer</Link>
          ) : <span />}
          <span className="text-xs text-muted-fg">Page {page}</span>
          {hasNext ? (
            <Link href={activityHref(view, page + 1)} className="btn btn-ghost">Older <ChevronRight size={15} /></Link>
          ) : <span />}
        </nav>
      ) : null}
    </AppShell>
  );
}

function activityHref(view: string, page: number) {
  const params = new URLSearchParams();
  if (view !== "all") params.set("view", view);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/history?${query}` : "/history";
}
