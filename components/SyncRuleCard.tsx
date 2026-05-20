import type { SyncDestination, SyncRule } from "@prisma/client";
import Link from "next/link";
import { Pencil, Play } from "lucide-react";
import { CancelSyncButton } from "./CancelSyncButton";
import { RunSyncButton } from "./RunSyncButton";
import { ServiceIcon, ServicePill, serviceMeta } from "./ServiceBrand";
import { StatusBadge } from "./StatusBadge";
import { SyncRuleHistory } from "./SyncRuleHistory";

function modeLabel(mode: string) {
  const labels: Record<string, string> = {
    ADD_ONLY: "Add new songs",
    ADD_AND_REMOVE: "Keep playlists matched",
    FULL_MIRROR: "Mirror playlist",
  };
  return labels[mode] || mode;
}

function formatRelative(target: Date | null | undefined): string | null {
  if (!target) return null;
  const diff = target.getTime() - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return diff > 0 ? "in a moment" : "just now";
  if (minutes < 60) return diff > 0 ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return diff > 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
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

export function SyncRuleCard({
  rule,
  progress,
  runningJob,
}: {
  rule: SyncRule & { destinations: SyncDestination[] };
  progress?: SyncRuleCardProgress;
  runningJob?: { id: string; startedAt: string } | null;
}) {
  const lastRunRel = formatRelative(rule.lastRunAt);
  const nextRunRel = rule.isEnabled ? formatRelative(rule.nextRunAt) : null;
  const sourceMeta = serviceMeta(rule.sourceService);

  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-[#0d0e12]/55 p-6 backdrop-blur-md transition-all hover:bg-[#0d0e12]/75 ${sourceMeta.border}`}>
      <div className={`pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full ${sourceMeta.bg} opacity-10 blur-[80px]`} />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <ServiceIcon service={rule.sourceService} size="sm" />
            <h3 className="text-lg font-bold tracking-tight text-white">{rule.name}</h3>
            <StatusBadge status={rule.isEnabled ? "connected" : "not_connected"} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ServicePill service={rule.sourceService} />
            <span className="text-xs font-semibold text-dim-fg">to</span>
            {rule.destinations.map((item) => (
              <ServicePill key={`${item.service}-${item.playlistId}`} service={item.service} />
            ))}
            <span className="pill">{modeLabel(rule.mode)}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={`/settings?rule=${rule.id}`} className="btn btn-ghost text-xs">
            <Pencil size={16} /> Edit
          </Link>
          {runningJob ? (
            <CancelSyncButton jobId={runningJob.id} startedAt={runningJob.startedAt} />
          ) : (
            <RunSyncButton ruleId={rule.id}>
              <Play size={16} /> Run now
            </RunSyncButton>
          )}
        </div>
      </div>

      {progress && progress.sourceTotal > 0 ? (
        <div className="relative mt-6 space-y-4">
          {progress.destinations.map((dest) => {
            const pct = Math.min(100, Math.round((dest.synced / progress.sourceTotal) * 100));
            const remaining = Math.max(0, progress.sourceTotal - dest.synced);
            const complete = pct >= 100;
            return (
              <div key={`${dest.service}::${dest.playlistId}`} className="text-sm">
                <div className="mb-2 flex items-end justify-between gap-3">
                  <span className="min-w-0 text-xs font-bold text-slate-300">
                    <span className="inline-flex max-w-full items-center gap-2">
                      <ServiceIcon service={dest.service} size="sm" className="h-5 w-5 rounded-md" />
                      <span className="shrink-0">{serviceMeta(dest.service).label}</span>
                      {dest.playlistName ? <span className="truncate text-slate-500 font-medium">/ {dest.playlistName}</span> : null}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-normal text-slate-500">
                    <span className="text-white">{dest.synced}</span>
                    <span className="mx-1">/</span>
                    {progress.sourceTotal}
                    {remaining > 0 ? <span className="ml-2 text-blue-500/60">{remaining} left</span> : null}
                    {dest.pendingReview > 0 ? <span className="ml-2 text-[#fcd34d]">/ {dest.pendingReview} review</span> : null}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full border border-white/5 bg-black/40">
                  <div
                    className={complete ? "h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" : "h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)]"}
                    style={{ width: `${pct}%`, transition: "width 500ms cubic-bezier(0.4, 0, 0.2, 1)" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {lastRunRel || nextRunRel ? (
        <div className="relative mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-fg">
          {lastRunRel ? (
            <span>
              Last run <span className="text-[var(--text)]">{lastRunRel}</span>
            </span>
          ) : null}
          {nextRunRel ? (
            <span>
              Next run <span className="text-[var(--text)]">{nextRunRel}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="relative">
        <SyncRuleHistory ruleId={rule.id} />
      </div>
    </div>
  );
}
