import Link from "next/link";
import { ArrowRight, ChevronDown, ListMusic, RotateCw } from "lucide-react";
import { Callout } from "./Callout";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";
import { StatusBadge } from "./StatusBadge";
import type { SyncJobStats } from "@/lib/sync/syncJobStats";

const TIME_ZONE = process.env.WORKER_ACCOUNT_TIMEZONE || "Europe/Riga";
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: TIME_ZONE,
});

export type SyncRunView = {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  errorKind: string | null;
  errorMessage: string | null;
  ruleName: string;
  groupId: string | null;
  groupName: string | null;
  sourceService: string;
  sourceName: string;
  destinations: Array<{ service: string; name: string }>;
  stats: SyncJobStats;
  logs: Array<{
    id: string;
    level: string;
    action: string;
    service: string;
    trackTitle: string;
    message: string;
  }>;
  logCount: number;
};

export function SyncRunList({ runs, selectedRunId }: { runs: SyncRunView[]; selectedRunId?: string }) {
  if (!runs.length) return null;

  return (
    <ol className="space-y-4" aria-label="Sync runs">
      {runs.map((run) => {
        const selected = run.id === selectedRunId;
        const attention = run.status === "FAILED" || run.status === "PARTIAL_SUCCESS";
        return (
          <li key={run.id} id={`run-${run.id}`} className="scroll-mt-6">
            <article
              className={`workbench overflow-hidden border-l-2 ${statusBorder(run.status)} ${
                selected ? "ring-2 ring-[var(--accent-ring)]" : ""
              }`}
            >
              <header className="p-4 sm:p-5">
                <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <ServiceIcon service={run.sourceService} size="lg" />
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h2 className="heading-panel truncate" title={run.groupName || run.ruleName}>
                          {run.groupName || run.ruleName}
                        </h2>
                        <StatusBadge status={run.status.toLowerCase()} />
                      </div>
                      <p className="mt-1 text-sm text-muted-fg">
                        <span className="font-medium text-[var(--text)]">{serviceMeta(run.sourceService).shortLabel}</span>
                        {" · "}{run.sourceName}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-dim-fg">
                        <time dateTime={run.startedAt.toISOString()}>{DATE_TIME.format(run.startedAt)}</time>
                        <span aria-hidden="true">·</span>
                        <span>{durationLabel(run.startedAt, run.finishedAt)}</span>
                        {run.status === "RUNNING" ? <span className="inline-flex items-center gap-1 text-[var(--accent)]"><RotateCw size={11} className="animate-spin" /> Live</span> : null}
                      </div>
                    </div>
                  </div>
                  {run.groupId ? (
                    <Link href={`/settings?group=${encodeURIComponent(run.groupId)}#group-editor`} className="btn btn-ghost self-start">
                      Open group
                    </Link>
                  ) : null}
                </div>

                <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <span className="inline-flex min-w-0 items-center gap-2 text-muted-fg">
                    <ServiceIcon service={run.sourceService} size="sm" />
                    <span className="max-w-52 truncate">{run.sourceName}</span>
                  </span>
                  <ArrowRight size={14} className="text-dim-fg" aria-hidden="true" />
                  {run.destinations.length ? (
                    run.destinations.map((destination) => (
                      <span key={`${destination.service}:${destination.name}`} className="pill">
                        <ServiceIcon service={destination.service} size="sm" className="h-4 w-4" />
                        <span className="max-w-44 truncate" title={destination.name}>{destination.name}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-danger-fg">No destinations</span>
                  )}
                </div>
                <OutcomeSummary stats={run.stats} />
              </header>

              {run.status === "FAILED" ? (
                <Callout tone="danger" className="mx-4 mb-4 sm:mx-5 sm:mb-5" title="Run failed">
                  <span className="break-words">{friendlyError(run.errorMessage, run.errorKind)}</span>
                </Callout>
              ) : run.status === "PARTIAL_SUCCESS" ? (
                <Callout tone="warning" className="mx-4 mb-4 sm:mx-5 sm:mb-5" title="Some songs still need attention">
                  {partialSummary(run.stats)}
                </Callout>
              ) : run.status === "CANCELLED" ? (
                <Callout className="mx-4 mb-4 sm:mx-5 sm:mb-5" title="Run stopped">
                  It was cancelled before every song could be processed.
                </Callout>
              ) : null}

              <details open={selected} className="group">
                <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-4 py-3 text-sm marker:content-none sm:px-5">
                  <span className="inline-flex items-center gap-2 font-medium text-muted-fg">
                    <ListMusic size={14} aria-hidden="true" />
                    Track events
                    <span className="pill">{run.logCount}</span>
                  </span>
                  <ChevronDown size={15} className="text-dim-fg transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="border-t border-line-soft px-4 pb-4 sm:px-5 sm:pb-5">
                  {run.errorMessage ? (
                    <details className="group/error border-b border-line-soft">
                      <summary className="flex min-h-11 list-none items-center justify-between gap-3 py-3 text-xs font-medium text-muted-fg marker:content-none">
                        Technical error
                        <ChevronDown size={13} className="transition-transform group-open/error:rotate-180" aria-hidden="true" />
                      </summary>
                      <div className="pb-3">
                        <code className="block whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-surface-2 p-3 text-xs leading-5 text-danger-fg">
                          {run.errorKind ? `[${run.errorKind}] ` : ""}{run.errorMessage}
                        </code>
                      </div>
                    </details>
                  ) : null}
                  {run.logs.length ? (
                    <ul className="rows">
                      {run.logs.map((log) => (
                        <li key={log.id} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center">
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <ServiceIcon service={log.service} size="sm" />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-[var(--text)]" title={log.trackTitle}>{log.trackTitle}</div>
                              <div className="mt-0.5 line-clamp-2 text-xs text-muted-fg">{messageLabel(log.message)}</div>
                            </div>
                          </div>
                          <StatusBadge status={log.level.toLowerCase()} label={actionLabel(log.action)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-4 text-sm text-muted-fg">
                      {attention
                        ? "No track events were recorded. The run stopped before song processing began."
                        : "No per-song changes were recorded for this run."}
                    </p>
                  )}
                  {run.logCount > run.logs.length ? (
                    <p className="border-t border-line-soft pt-3 text-xs text-dim-fg">
                      Showing the latest {run.logs.length} of {run.logCount} track events.
                    </p>
                  ) : null}
                </div>
              </details>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

function OutcomeSummary({ stats }: { stats: SyncJobStats }) {
  const items = [
    { label: "added", value: stats.synced, tone: "text-[var(--accent)]" },
    { label: "already there", value: stats.alreadySynced, tone: "text-[var(--text)]" },
    { label: "need review", value: stats.manualRequired, tone: "text-warning-fg" },
    { label: "not found", value: stats.notFound, tone: "text-danger-fg" },
    { label: "removed", value: stats.removed, tone: "text-[var(--text)]" },
  ].filter((item) => item.value > 0);

  return (
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line-soft pt-3 text-xs text-muted-fg">
      {items.length ? (
        items.map((item) => (
          <span key={item.label} className="inline-flex items-baseline gap-1.5">
            <strong className={`text-base font-semibold tabular-nums ${item.tone}`}>{item.value}</strong>
            {item.label}
          </span>
        ))
      ) : (
        <span>No track changes recorded</span>
      )}
    </div>
  );
}

function statusBorder(status: string) {
  if (status === "FAILED") return "border-l-danger";
  if (status === "PARTIAL_SUCCESS") return "border-l-warning";
  if (status === "RUNNING") return "border-l-accent";
  if (status === "SUCCESS") return "border-l-success";
  return "border-l-[var(--text-dim)]";
}

function durationLabel(startedAt: Date, finishedAt: Date | null) {
  if (!finishedAt) return "In progress";
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function partialSummary(stats: SyncJobStats) {
  const parts = [
    stats.manualRequired ? `${stats.manualRequired} need your review` : null,
    stats.notFound ? `${stats.notFound} could not be found` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")}.` : "The run completed only partially. Open the track events for details.";
}

function friendlyError(message: string | null, kind: string | null) {
  if (!message) return "The run stopped unexpectedly. Check the connected platform and try again.";
  if (kind === "auth") return "The platform session is no longer valid. Refresh it on the Connections page, then run this group again.";
  if (kind === "captcha") return "The platform requested a browser check. Refresh the saved session before running this group again.";
  if (/already has a running|another sync is already/i.test(message)) {
    return "Another synchronization is already using this group. Wait for it to finish, then try again.";
  }
  if (/timed out|timeout|exceeded wall-clock/i.test(message)) {
    return "The platform did not respond in time. Check its connection and try the group again.";
  }
  if (/playlist.*not found|stored id predates|resolved .* by playlist slug/i.test(message)) {
    return "The destination playlist could not be found. Refresh playlists or reconnect it to this group, then try again.";
  }
  if (/preflight failed/i.test(message)) {
    return "A safety check stopped this run before any songs changed. Refresh the affected playlist or connection, then try again.";
  }
  return "The platform operation failed. Open the technical error below for details, then check the connection before retrying.";
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    already_synced: "Already added",
    synced: "Added",
    manual_required: "Needs review",
    rejected_candidate: "Skipped",
    not_found: "Not found",
    removed: "Removed",
  };
  return labels[action] || action.replaceAll("_", " ");
}

function messageLabel(message: string) {
  return message
    .replace(/Already present.*/i, "Already in the playlist")
    .replace(/Added with.*/i, "Added to the playlist")
    .replace(/Manual review required.*/i, "Please choose the right song")
    .replace(/No reliable match found.*/i, "No matching song found")
    .replace(/Removed system-added track missing from source.*/i, "Removed from the playlist");
}
