import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Cpu, PlugZap, RotateCw, Shuffle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Callout } from "@/components/Callout";
import { ServiceIcon, ServicePill, serviceMeta } from "@/components/ServiceBrand";
import { PlaylistsAutoRefresh } from "@/components/PlaylistsAutoRefresh";
import { RunningJobsAutoRefresh } from "@/components/RunningJobsAutoRefresh";
import { RunDueSyncQueueButton } from "@/components/RunDueSyncQueueButton";
import { classifySession, type SessionStaleness } from "@/components/SessionStalenessBanner";
import { SyncRuleCard } from "@/components/SyncRuleCard";
import { SyncRuleGroupCard } from "@/components/SyncRuleGroupCard";
import { StatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";
import { buildSourcePlaylistGroupMap, ruleBatchKey } from "@/lib/sync/groupAwareRuleLimit";

const WORKER_SERVICES = ["youtube", "spotify", "soundcloud"];
const WORKER_STALE_WHILE_QUEUED_MS = 30 * 60_000;
const WORKER_RUNNING_STALE_MS = 60 * 60_000;
const DATE_TIME = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

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

type WorkerSkippedReason = {
  ruleId?: string;
  name?: string;
  reason: string;
  detail?: string;
};

type WorkerWarning = {
  tone: "warning" | "danger";
  title: string;
  detail: string;
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
  const [rules, lastJob, playlists, sessionRows, pendingReviewCount, runningJobs, recentJobs, groupMembers, lastWorkerRun] = await Promise.all([
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
    prisma.workerRun.findFirst({
      where: { worker: "sync-worker" },
      orderBy: { startedAt: "desc" },
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
  const sourceGroupMap = buildSourcePlaylistGroupMap(
    groupMembers.map((member) => ({
      groupId: member.groupId,
      playlist: {
        service: member.playlist.service,
        servicePlaylistId: member.playlist.servicePlaylistId,
      },
    })),
  );
  const dueRules = rules.filter((rule) => rule.isEnabled && (!rule.nextRunAt || rule.nextRunAt <= new Date(now)));
  const dueSyncBatches = new Set(dueRules.map((rule) => ruleBatchKey(rule, sourceGroupMap))).size;
  const queuePreviewRules = dueRules.slice(0, 4);
  const hiddenQueueRules = Math.max(0, dueRules.length - queuePreviewRules.length);
  const futureRuns = rules
    .filter((rule) => rule.isEnabled && rule.nextRunAt && rule.nextRunAt > new Date(now))
    .sort((a, b) => a.nextRunAt!.getTime() - b.nextRunAt!.getTime());
  const nextScheduledRun = futureRuns[0]?.nextRunAt ?? null;
  const workerSkippedReasons = parseWorkerSkippedReasons(lastWorkerRun?.skippedJson);
  const workerWarnings = buildWorkerWarnings({
    lastWorkerRun,
    queuedRules: dueRules.length,
    now,
  });
  const groupedRules = new Map<string, RuleWithDestinations[]>();
  const standaloneRules: RuleWithDestinations[] = [];
  for (const rule of rules) {
    const member = memberByPlaylistKey.get(`${rule.sourceService}:${rule.sourcePlaylistId}`);
    const groupPlaylistKeys = member
      ? new Set(
          groupMembers
            .filter((groupMember) => groupMember.groupId === member.groupId)
            .map((groupMember) => `${groupMember.playlist.service}:${groupMember.playlist.servicePlaylistId}`),
        )
      : null;
    const staysInsideGroup = Boolean(
      groupPlaylistKeys &&
        rule.destinations.length > 0 &&
        rule.destinations.every((destination) => groupPlaylistKeys.has(`${destination.service}:${destination.playlistId}`)),
    );
    if (member && (rule.direction === "TWO_WAY" || staysInsideGroup)) {
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
  const failedRuleCount = rules.filter((rule) => {
    const status = latestJobByRule.get(rule.id)?.status;
    return status === "FAILED" || status === "PARTIAL_SUCCESS";
  }).length;
  const attentionCount = Number(pendingReviewCount > 0) + Number(staleSessions.length > 0) + Number(workerWarnings.length > 0 || failedRuleCount > 0);

  return (
    <AppShell
      title="Overview"
      description="See what needs you, what is running, and whether playlist copies are healthy."
    >
      <PlaylistsAutoRefresh hasPlaylists={playlists.length > 0} lastChangedAt={lastChangedAt?.toISOString() || null} />
      <RunningJobsAutoRefresh runningCount={runningJobs.length} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)] lg:items-start">
        <div className="grid gap-5">
          <section className="workbench overflow-hidden" aria-labelledby="attention-heading">
          <div className="workbench-header">
            <div>
              <div className="eyebrow text-muted-fg">Today</div>
              <h2 id="attention-heading" className="heading-card mt-1">What needs attention</h2>
            </div>
            <span className={`pill ${attentionCount ? "pill-warning" : "pill-success"}`}>
              {attentionCount ? `${attentionCount} ${attentionCount === 1 ? "area" : "areas"}` : "All clear"}
            </span>
          </div>
          <div className="rows px-4 sm:px-5">
            <DashboardActionRow
              icon={<Shuffle size={17} />}
              title={pendingReviewCount ? `${pendingReviewCount} songs need a decision` : "Review queue is clear"}
              detail={pendingReviewCount ? "Choose the right version so future syncs can reuse it." : "No uncertain matches are blocking copies."}
              href="/manual-match"
              action={pendingReviewCount ? "Review" : "Open queue"}
              tone={pendingReviewCount ? "warning" : "success"}
            />
            <DashboardActionRow
              icon={<PlugZap size={17} />}
              title={staleSessions.length ? `${staleSessions.length} connections need a refresh` : "Connections are ready"}
              detail={staleSessions.length ? staleSessions.map(sessionIssueLabel).join(" · ") : "Spotify, YouTube Music and SoundCloud can be reached."}
              href="/connections"
              action="Manage"
              tone={staleSessions.length ? "danger" : "success"}
            />
            <DashboardActionRow
              icon={failedRuleCount || workerWarnings.length ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
              title={failedRuleCount ? `${failedRuleCount} playlist ${failedRuleCount === 1 ? "copy has" : "copies have"} an issue` : workerWarnings.length ? workerWarnings[0].title : "Recent copies look healthy"}
              detail={failedRuleCount ? "Open the affected copy below for the latest error and progress." : workerWarnings.length ? workerWarnings[0].detail : "No failed or partial runs need action."}
              href={failedRuleCount ? "#playlist-copies" : "/history"}
              action={failedRuleCount ? "View copies" : "Activity"}
              tone={failedRuleCount || workerWarnings.length ? "warning" : "success"}
            />
          </div>
          </section>

          <section className="workbench" aria-labelledby="latest-run-heading">
            <div className="workbench-header">
              <div>
                <div className="eyebrow flex items-center gap-1.5 text-muted-fg"><Activity size={12} /> Latest run</div>
                <h2 id="latest-run-heading" className="heading-panel mt-1">
                  {lastJob ? DATE_TIME.format(lastJob.finishedAt || lastJob.startedAt) : "No runs yet"}
                </h2>
              </div>
              {lastJob ? <StatusBadge status={lastJob.status.toLowerCase()} /> : null}
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-5 p-4 sm:grid-cols-4 sm:p-5">
              <StatTile value={stats.synced} label="Added" tone="accent" />
              <StatTile value={stats.alreadySynced || 0} label="Already there" tone="neutral" />
              <StatTile value={stats.notFound} label="Not found" tone="danger" />
              <StatTile value={pendingReviewCount} label="Review" tone="warning" />
            </div>
            <div className="flex items-center justify-between border-t border-line-soft px-4 py-3 sm:px-5">
              <span className="text-xs text-muted-fg">{bySourceEntries.length ? `${bySourceEntries.length} match sources` : "No source breakdown"}</span>
              <Link
                href={lastJob ? `/history?run=${encodeURIComponent(lastJob.id)}#run-${encodeURIComponent(lastJob.id)}` : "/history"}
                className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-[var(--accent)]"
              >
                Open activity <ArrowRight size={12} />
              </Link>
            </div>
          </section>
        </div>

        <div className="grid gap-5">
          <section className="workbench" aria-labelledby="automation-heading">
            <div className="workbench-header">
              <div>
                <div className="eyebrow flex items-center gap-1.5 text-muted-fg">
                  <RotateCw size={12} /> Automation
                </div>
                <h2 id="automation-heading" className="heading-panel mt-1">
                  {runningJobs.length
                    ? `${runningJobs.length} running now`
                    : dueRules.length
                      ? `${dueRules.length} ready to run`
                      : "Queue is caught up"}
                </h2>
              </div>
              <span className={`signal-dot ${workerWarnings.length ? "signal-dot-warning" : "signal-dot-success"}`} aria-hidden="true" />
            </div>
            <div className="p-4 sm:p-5">
              <div className="grid grid-cols-3 gap-3">
                <QueueMetric label="Due" value={dueRules.length} tone={dueRules.length ? "accent" : "neutral"} />
                <QueueMetric label="Batches" value={dueSyncBatches} tone={dueSyncBatches ? "accent" : "neutral"} />
                <QueueMetric label="Running" value={runningJobs.length} tone={runningJobs.length ? "success" : "neutral"} />
              </div>
              <div className="mt-5 [&>button]:w-full">
                <RunDueSyncQueueButton disabled={!dueRules.length || runningJobs.length > 0} />
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-fg">
                {dueRules.length
                  ? "Runs the same guarded queue as the background worker."
                  : nextScheduledRun
                    ? `Next copy is due ${DATE_TIME.format(nextScheduledRun)}.`
                    : "New changes will appear here automatically."}
              </p>
              {workerWarnings.length ? (
                <Callout tone={workerWarnings[0].tone} className="mt-4" title={workerWarnings[0].title}>
                  <span className="text-xs">{workerWarnings[0].detail}</span>
                </Callout>
              ) : null}
            </div>
            <details className="group border-t border-line-soft">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-medium text-muted-fg marker:content-none sm:px-5">
                <span className="inline-flex items-center gap-2"><Cpu size={14} /> Queue and worker details</span>
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-line-soft px-4 py-4 text-xs sm:px-5">
                <p className="text-muted-fg">
                  {lastWorkerRun
                    ? `Last ${lastWorkerRun.status.toLowerCase().replaceAll("_", " ")} run ${DATE_TIME.format(lastWorkerRun.startedAt)} · ${lastWorkerRun.ran} ran · ${lastWorkerRun.failed} failed · ${lastWorkerRun.skipped} skipped`
                    : "No sync-worker runs recorded yet."}
                </p>
                {queuePreviewRules.length ? (
                  <div className="rows mt-3 border-t border-line-soft">
                    {queuePreviewRules.map((rule) => (
                      <SyncQueueRuleRow key={rule.id} rule={rule} running={Boolean(runningByRule.get(rule.id))} />
                    ))}
                    {hiddenQueueRules > 0 ? <div className="py-2 text-muted-fg">+ {hiddenQueueRules} more queued</div> : null}
                  </div>
                ) : null}
                {workerSkippedReasons.length ? (
                  <div className="rows mt-3 border-t border-line-soft">
                    {workerSkippedReasons.slice(0, 3).map((item, index) => (
                      <div key={`${item.ruleId || item.reason}:${index}`} className="py-2 text-muted-fg">
                        <span className="font-semibold text-[var(--text)]">{item.name || item.reason}</span> · {item.reason}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          </section>

        </div>
      </div>

      <section id="playlist-copies" className="section scroll-mt-6">
        <div className="section-head">
          <h2 className="heading-section">Playlist copies</h2>
          <span className="pill pill-accent">
            {ruleGroups.length + standaloneRules.length} item{ruleGroups.length + standaloneRules.length === 1 ? "" : "s"}
          </span>
        </div>
        {rules.length ? (
          <div className="rows">
            {ruleGroups.map((item) =>
              item.group ? (
                 <SyncRuleGroupCard
                   key={item.group.id}
                   groupId={item.group.id}
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
                latestJob={latestJobByRule.get(rule.id) ?? null}
              />
            ))}
          </div>
        ) : (
          <p className="py-6 text-sm text-muted-fg">
            No sync rules yet. Open a playlist and pick a destination to connect them.
          </p>
        )}
      </section>
    </AppShell>
  );
}

function StatTile({ value, label, tone }: { value: number; label: string; tone: "accent" | "neutral" | "danger" | "warning" }) {
  const valueClass =
    tone === "accent" ? "text-[var(--accent)]" : tone === "danger" ? "text-danger-fg" : tone === "warning" ? "text-warning-fg" : "text-[var(--text)]";
  return (
    <div>
      <div className={`text-2xl font-semibold tracking-tight tabular-nums ${valueClass}`}>{value}</div>
      <div className="eyebrow mt-1 text-muted-fg">{label}</div>
    </div>
  );
}

function QueueMetric({ value, label, tone }: { value: number; label: string; tone: "accent" | "neutral" | "success" }) {
  const valueClass =
    tone === "accent" ? "text-[var(--accent)]" : tone === "success" ? "text-success-fg" : "text-[var(--text)]";
  return (
    <div className="min-w-16">
      <div className={`text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className="eyebrow mt-1 text-muted-fg">{label}</div>
    </div>
  );
}

function DashboardActionRow({
  icon,
  title,
  detail,
  href,
  action,
  tone,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  href: string;
  action: string;
  tone: "success" | "warning" | "danger";
}) {
  const toneClass = tone === "success" ? "text-success-fg" : tone === "danger" ? "text-danger-fg" : "text-warning-fg";
  return (
    <Link href={href} className="group flex min-w-0 items-center gap-3 py-4">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-surface-2 ${toneClass}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="heading-row block">{title}</span>
        <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted-fg">{detail}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--accent)]">
        <span className="hidden sm:inline">{action}</span><ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function sessionIssueLabel(item: SessionStaleness): string {
  const name = serviceMeta(item.service).shortLabel;
  if (item.severity === "missing") return `${name} missing`;
  if (item.severity === "stale") return `${name} ${item.daysOld}d old`;
  return `${name} ageing`;
}

function SyncQueueRuleRow({ rule, running }: { rule: RuleWithDestinations; running: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <ServiceIcon service={rule.sourceService} size="sm" />
        <div className="min-w-0">
          <div className="heading-row truncate">{rule.name}</div>
          <div className="truncate text-xs text-muted-fg">
            {serviceMeta(rule.sourceService).label} source - {queueReasonLabel(rule.queuedReason)} - every{" "}
            {rule.intervalMinutes}m
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {rule.destinations.map((destination) => (
          <ServicePill
            key={`${rule.id}:${destination.service}:${destination.playlistId}`}
            service={destination.service}
          />
        ))}
        <span className={`pill ${running ? "pill-accent animate-pulse" : "pill-warning"}`}>
          {running ? "Running" : "Waiting"}
        </span>
      </div>
    </div>
  );
}

function queueReasonLabel(reason?: string | null): string {
  if (reason === "manual_match_resolved") return "Manual match";
  if (reason === "rule_created") return "New rule";
  if (reason === "rule_updated") return "Rule edit";
  if (reason === "rule_enabled") return "Enabled";
  if (reason === "playlist_group_connected") return "Connected";
  return "Queued";
}

function parseWorkerSkippedReasons(value?: string | null): WorkerSkippedReason[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: WorkerSkippedReason[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const reason = typeof raw.reason === "string" ? raw.reason : "";
      if (!reason) continue;
      out.push({
        ruleId: typeof raw.ruleId === "string" ? raw.ruleId : undefined,
        name: typeof raw.name === "string" ? raw.name : undefined,
        reason,
        detail: typeof raw.detail === "string" ? raw.detail : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function buildWorkerWarnings({
  lastWorkerRun,
  queuedRules,
  now,
}: {
  lastWorkerRun: {
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    errorMessage?: string | null;
  } | null;
  queuedRules: number;
  now: number;
}): WorkerWarning[] {
  if (queuedRules <= 0 && !lastWorkerRun) return [];

  const warnings: WorkerWarning[] = [];
  if (queuedRules > 0 && !lastWorkerRun) {
    warnings.push({
      tone: "warning",
      title: "Sync queue is waiting, but worker has never reported in",
      detail: "Start npm run sync-worker or the worker supervisor so queued rules can run.",
    });
    return warnings;
  }

  if (!lastWorkerRun) return warnings;

  const ageMs = now - lastWorkerRun.startedAt.getTime();
  if (lastWorkerRun.status === "FAILED") {
    warnings.push({
      tone: "danger",
      title: "Last sync-worker run failed",
      detail: lastWorkerRun.errorMessage || "Check worker logs before relying on queued sync.",
    });
  }
  if (lastWorkerRun.status === "RUNNING" && !lastWorkerRun.finishedAt && ageMs > WORKER_RUNNING_STALE_MS) {
    warnings.push({
      tone: "danger",
      title: "Sync worker run looks stuck",
      detail: `It has been running for ${Math.round(ageMs / 60_000)} minutes.`,
    });
  }
  if (queuedRules > 0 && lastWorkerRun.status !== "RUNNING" && ageMs > WORKER_STALE_WHILE_QUEUED_MS) {
    warnings.push({
      tone: "warning",
      title: "Queued sync has not been picked up recently",
      detail: `Last worker run started ${Math.round(ageMs / 60_000)} minutes ago while ${queuedRules} rule${queuedRules === 1 ? "" : "s"} are waiting.`,
    });
  }
  return warnings;
}
