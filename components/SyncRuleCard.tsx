import type { SyncDestination, SyncRule } from "@prisma/client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Pencil, Play } from "lucide-react";
import { Callout } from "./Callout";
import { CancelSyncButton } from "./CancelSyncButton";
import { RunSyncButton } from "./RunSyncButton";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";
import { SyncRuleHistory } from "./SyncRuleHistory";

function modeLabel(mode: string) {
  const labels: Record<string, string> = {
    ADD_ONLY: "Add new songs",
    ADD_AND_REMOVE: "Keep playlists matched",
    FULL_MIRROR: "Mirror playlist",
  };
  return labels[mode] || mode;
}

function humanizeMs(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "a moment";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatRelative(target: Date | null | undefined): string | null {
  if (!target) return null;
  const diff = target.getTime() - Date.now();
  if (Math.abs(diff) < 60_000) return diff > 0 ? "in a moment" : "just now";
  return diff > 0 ? `in ${humanizeMs(diff)}` : `${humanizeMs(-diff)} ago`;
}

// A scheduled run whose time has passed is not "next" — it is late. Rendering it
// as `Next 12h ago` (which is what a plain relative format produced) hid exactly
// the case worth noticing: the worker is not keeping up with this rule.
export function formatNextRun(target: Date | null | undefined): { label: string; late: boolean } | null {
  if (!target) return null;
  const diff = target.getTime() - Date.now();
  if (diff > 0) return { label: `next in ${humanizeMs(diff)}`, late: false };
  if (diff > -120_000) return { label: "due now", late: false };
  return { label: `overdue by ${humanizeMs(-diff)}`, late: true };
}

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

export function SyncRuleCard({
  rule,
  progress,
  runningJob,
  latestJob,
}: {
  rule: SyncRule & { destinations: SyncDestination[] };
  progress?: SyncRuleCardProgress;
  runningJob?: { id: string; startedAt: string } | null;
  latestJob?: SyncRuleJobSummary | null;
}) {
  const lastRunRel = formatRelative(rule.lastRunAt);
  const nextRun = rule.isEnabled ? formatNextRun(rule.nextRunAt) : null;
  const sourceMeta = serviceMeta(rule.sourceService);
  const running = Boolean(runningJob);
  const activeDestinations = rule.destinations.filter((destination) => destination.isEnabled);
  const partial = latestJob?.status === "PARTIAL_SUCCESS";
  const failed = latestJob?.status === "FAILED";

  // One badge, not seven pills of equal weight: this is the rule's state, and
  // everything else on the card is detail underneath it.
  const state = running
    ? { label: "Running", className: "pill-accent" }
    : failed
      ? { label: "Failed", className: "pill-danger" }
      : partial
        ? { label: "Partial", className: "pill-warning" }
        : !rule.isEnabled
          ? { label: "Paused", className: "" }
          : { label: "Listening", className: "pill-success" };

  return (
    <div className="py-4 sm:py-5">
      {/* No frame and no brand stripe down the left edge: this is a row in a
          divided list now, and the stripe repeated what the service icon
          immediately to its right already says. */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <ServiceIcon service={rule.sourceService} size="sm" />
          <div className="min-w-0">
            <h3 className="heading-panel truncate" title={rule.name}>
              {rule.name}
            </h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-fg">
              <span className={`pill ${state.className}`}>{state.label}</span>
              <span>{modeLabel(rule.mode)}</span>
              {rule.intervalMinutes ? <span>· every {rule.intervalMinutes}m</span> : null}
              {lastRunRel ? <span>· ran {lastRunRel}</span> : null}
              {nextRun ? (
                <span className={nextRun.late ? "text-warning-fg" : undefined}>· {nextRun.label}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={`/settings?rule=${rule.id}`} className="btn btn-ghost">
            <Pencil size={15} /> Edit
          </Link>
          {runningJob ? (
            <CancelSyncButton jobId={runningJob.id} startedAt={runningJob.startedAt} />
          ) : (
            <RunSyncButton ruleId={rule.id}>
              <Play size={15} /> Run now
            </RunSyncButton>
          )}
        </div>
      </div>

      {/* Route, as one sentence rather than two labelled boxes whose captions
          collided with the chips on narrow screens. */}
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-muted-fg">{sourceMeta.label}</span>
        <ArrowRight size={14} className="text-dim-fg" />
        {activeDestinations.length ? (
          activeDestinations.map((item) => (
            <span key={`${item.service}-${item.playlistId}`} className="text-[var(--text)]">
              {serviceMeta(item.service).label}
            </span>
          ))
        ) : (
          <span className="text-danger-fg">No destinations</span>
        )}
      </div>

      {failed || partial ? (
        latestJob?.errorMessage ? (
          <Callout tone={failed ? "danger" : "warning"} className="mt-3">
            <span className="line-clamp-2 break-words" title={latestJob.errorMessage}>
              {latestJob.errorMessage}
            </span>
          </Callout>
        ) : (
          <Callout tone="warning" className="mt-3" icon={<AlertTriangle size={16} className="mt-0.5 shrink-0" />}>
            Last run finished as {latestJob?.status.toLowerCase().replaceAll("_", " ")}.
          </Callout>
        )
      ) : null}

      {progress && progress.sourceTotal > 0 ? (
        <div className="mt-4 space-y-3">
          {progress.destinations.map((dest) => {
            const pct = Math.min(100, Math.round((dest.synced / progress.sourceTotal) * 100));
            const complete = pct >= 100;
            const destMeta = serviceMeta(dest.service);
            return (
              <div key={`${dest.service}::${dest.playlistId}`}>
                <div className="mb-1.5 flex min-w-0 items-baseline justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="shrink-0 text-muted-fg">{destMeta.label}</span>
                    {dest.playlistName ? (
                      <span className="truncate text-dim-fg" title={dest.playlistName}>
                        {dest.playlistName}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-muted-fg">
                    <span className="tabular-nums text-[var(--text)]">{dest.synced}</span> of{" "}
                    <span className="tabular-nums">{progress.sourceTotal}</span>
                    {dest.pendingReview > 0 ? (
                      <span className="text-warning-fg"> · {dest.pendingReview} to review</span>
                    ) : null}
                    {complete ? (
                      <CheckCircle2 size={13} className="ml-1.5 inline align-[-2px] text-success" />
                    ) : null}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`dist-bar-fill h-full ${complete ? "bg-success" : destMeta.bg}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <SyncRuleHistory ruleId={rule.id} />
    </div>
  );
}
