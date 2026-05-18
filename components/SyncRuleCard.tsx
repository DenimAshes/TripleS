import type { SyncDestination, SyncRule } from "@prisma/client";
import Link from "next/link";
import { Pencil, Play } from "lucide-react";
import { RunSyncButton } from "./RunSyncButton";
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
}: {
  rule: SyncRule & { destinations: SyncDestination[] };
  progress?: SyncRuleCardProgress;
}) {
  const lastRunRel = formatRelative(rule.lastRunAt);
  const nextRunRel = rule.isEnabled ? formatRelative(rule.nextRunAt) : null;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-[#0d0e12]/40 p-6 backdrop-blur-md transition-all hover:bg-[#0d0e12]/60">
      <div className="absolute top-0 right-0 h-[1px] w-full bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />
      
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-bold tracking-tight text-white">{rule.name}</h3>
            <StatusBadge status={rule.isEnabled ? "connected" : "not_connected"} />
          </div>
          <p className="mt-2 text-xs font-bold uppercase tracking-widest text-slate-500">
            <span className="text-blue-400">{rule.sourceService}</span>
            <span className="mx-2 text-slate-700">/</span>
            <span className="text-blue-400">{rule.destinations.map((item) => item.service).join(", ")}</span>
            <span className="mx-3 text-slate-800">|</span>
            <span className="italic tracking-normal normal-case text-slate-400 font-medium">{modeLabel(rule.mode)}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={`/settings?rule=${rule.id}`} className="rounded-xl bg-white/5 px-4 py-2 text-xs font-bold text-slate-400 transition-all hover:bg-white/10 hover:text-white">
            <Pencil size={16} /> Edit
          </Link>
          <RunSyncButton ruleId={rule.id}>
            <Play size={16} /> Run now
          </RunSyncButton>
        </div>
      </div>
      {progress && progress.sourceTotal > 0 ? (
        <div className="mt-6 space-y-4">
          {progress.destinations.map((dest) => {
            const pct = Math.min(100, Math.round((dest.synced / progress.sourceTotal) * 100));
            const remaining = Math.max(0, progress.sourceTotal - dest.synced);
            const complete = pct >= 100;
            return (
              <div key={`${dest.service}::${dest.playlistId}`} className="text-sm">
                <div className="flex items-end justify-between gap-3 mb-2">
                  <span className="text-xs font-bold text-slate-300">
                    {dest.service}
                    {dest.playlistName ? <span className="text-slate-500 ml-2 font-medium tracking-tight">· {dest.playlistName}</span> : null}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap uppercase tracking-tighter">
                    <span className="text-white">{dest.synced}</span>
                    <span className="mx-1">/</span>{progress.sourceTotal}
                    {remaining > 0 ? <span className="ml-2 text-blue-500/60">{remaining} left</span> : null}
                    {dest.pendingReview > 0 ? (
                      <span className="ml-2 text-[#fcd34d] font-medium">· {dest.pendingReview} review</span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/40 border border-white/5">
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

      {(lastRunRel || nextRunRel) ? (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-fg">
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

      <SyncRuleHistory ruleId={rule.id} />
    </div>
  );
}
