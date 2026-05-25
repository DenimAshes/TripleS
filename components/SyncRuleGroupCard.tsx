import type { SyncDestination, SyncRule } from "@prisma/client";
import { AlertTriangle, CheckCircle2, Clock3, GitBranch, Play } from "lucide-react";
import Link from "next/link";
import { CancelSyncButton } from "./CancelSyncButton";
import { RunSyncButton } from "./RunSyncButton";
import { ServiceIcon, ServicePill } from "./ServiceBrand";
import { SyncSourceToggleButton } from "./SyncSourceToggleButton";
import { StatusBadge } from "./StatusBadge";

type RuleWithDestinations = SyncRule & { destinations: SyncDestination[] };

export type SyncRuleCardProgress = {
  sourceTotal: number;
  destinations: Array<{
    service: string;
    playlistId: string;
    playlistName?: string;
    synced: number;
    pendingReview: number;
  }>;
};

export type SyncRuleJobSummary = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  errorMessage?: string | null;
};

export type SyncRuleGroupMember = {
  id: string;
  service: string;
  name: string;
  servicePlaylistId: string;
};

export function SyncRuleGroupCard({
  groupName,
  members,
  rules,
  runningByRule,
  progressByRule,
  latestJobByRule,
}: {
  groupName: string;
  members: SyncRuleGroupMember[];
  rules: RuleWithDestinations[];
  runningByRule?: Map<string, { id: string; startedAt: string }>;
  progressByRule?: Map<string, SyncRuleCardProgress>;
  latestJobByRule?: Map<string, SyncRuleJobSummary>;
}) {
  const enabled = rules.filter((rule) => rule.isEnabled).length;
  const sourceNames = new Map(members.map((member) => [`${member.service}:${member.servicePlaylistId}`, member.name]));
  const activeRunning = rules.filter((rule) => runningByRule?.has(rule.id)).length;
  const latestFailed = rules
    .map((rule) => latestJobByRule?.get(rule.id))
    .find((job) => job?.status === "FAILED" || job?.status === "PARTIAL_SUCCESS");
  const progressRows = rules
    .map((rule) => progressByRule?.get(rule.id))
    .filter((progress): progress is SyncRuleCardProgress => Boolean(progress));
  const syncedTotal = progressRows.reduce(
    (sum, progress) => sum + progress.destinations.reduce((inner, destination) => inner + destination.synced, 0),
    0,
  );
  const pendingReview = progressRows.reduce(
    (sum, progress) => sum + Math.max(0, ...progress.destinations.map((destination) => destination.pendingReview)),
    0,
  );
  const destinationSlots = rules.reduce((sum, rule) => sum + rule.destinations.length, 0);
  const expectedCopies = progressRows.reduce(
    (sum, progress) => sum + progress.sourceTotal * progress.destinations.length,
    0,
  );
  const completion = expectedCopies > 0 ? Math.min(100, Math.round((syncedTotal / expectedCopies) * 100)) : 0;
  const groupState = activeRunning
    ? { icon: <Clock3 size={14} />, label: `${activeRunning} running`, className: "text-[var(--accent)]" }
    : pendingReview > 0
      ? { icon: <AlertTriangle size={14} />, label: `${pendingReview} review`, className: "text-[#fcd34d]" }
      : latestFailed
        ? { icon: <AlertTriangle size={14} />, label: latestFailed.status === "PARTIAL_SUCCESS" ? "Partial" : "Failed", className: "text-[#fca5a5]" }
        : enabled
          ? { icon: <CheckCircle2 size={14} />, label: "Listening", className: "text-emerald-300" }
          : { icon: <AlertTriangle size={14} />, label: "Off", className: "text-muted-fg" };

  return (
    <div className="panel surface-lift animated-sheen relative overflow-hidden p-5">
      <span className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-full bg-[var(--accent)] opacity-70" />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <GitBranch size={16} />
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-fg">Linked playlist group</span>
            <h3 className="truncate text-lg font-bold tracking-tight text-white">{groupName}</h3>
            <StatusBadge status={enabled ? "connected" : "not_connected"} />
            <span className="pill">{enabled}/{rules.length} source platforms</span>
            <span className={`pill ${groupState.className}`}>
              {groupState.icon}
              {groupState.label}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {members.map((member) => (
              <span key={member.id} className="pill">
                <ServiceIcon service={member.service} size="sm" />
                <span className="max-w-40 truncate">{member.name}</span>
              </span>
            ))}
          </div>
        </div>

        <Link href="/playlists" className="btn btn-ghost text-xs">
          Edit group
        </Link>
      </div>

      {progressRows.length || latestFailed ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <GroupMetric label="Progress" value={expectedCopies ? `${completion}%` : "-"} detail={`${syncedTotal}/${expectedCopies || 0} copies`} />
          <GroupMetric label="Sources" value={String(enabled)} detail={`${members.length} linked playlists`} />
          <GroupMetric label="Targets" value={String(destinationSlots)} detail="write destinations" />
          <GroupMetric
            label={latestFailed ? "Last issue" : "Review"}
            value={latestFailed ? latestFailed.status.replace("_", " ") : String(pendingReview)}
            detail={latestFailed?.errorMessage ? latestFailed.errorMessage : pendingReview ? "needs your choice" : "clear"}
            tone={latestFailed || pendingReview ? "warn" : "ok"}
          />
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rules.map((rule) => {
          const runningJob = runningByRule?.get(rule.id) ?? null;
          const sourceName = sourceNames.get(`${rule.sourceService}:${rule.sourcePlaylistId}`) || rule.name;
          return (
            <div key={rule.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)]/55 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                    <ServiceIcon service={rule.sourceService} size="sm" />
                    <span className="truncate">{sourceName}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-fg">
                    {rule.isEnabled ? "Changes here sync to:" : "Changes here are ignored"}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {rule.destinations.map((destination) => (
                      <ServicePill key={`${rule.id}:${destination.service}:${destination.playlistId}`} service={destination.service} />
                    ))}
                  </div>
                  {progressByRule?.get(rule.id) ? (
                    <div className="mt-2 text-[11px] font-medium text-dim-fg">
                      {progressByRule
                        .get(rule.id)!
                        .destinations.map((destination) => `${destination.synced}/${progressByRule.get(rule.id)!.sourceTotal} ${destination.service}`)
                        .join(" · ")}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <SyncSourceToggleButton ruleId={rule.id} enabled={rule.isEnabled} serviceLabel={rule.sourceService} />
                  {runningJob ? (
                    <CancelSyncButton jobId={runningJob.id} startedAt={runningJob.startedAt} />
                  ) : (
                    <RunSyncButton ruleId={rule.id}>
                      <Play size={14} /> Run
                    </RunSyncButton>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroupMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const valueClass = tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-[#fcd34d]" : "text-[var(--text)]";
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)]/40 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-dim-fg">{label}</div>
      <div className={`mt-1 truncate text-sm font-black ${valueClass}`}>{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted-fg" title={detail}>
        {detail}
      </div>
    </div>
  );
}
