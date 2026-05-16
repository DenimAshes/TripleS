import type { SyncDestination, SyncRule } from "@prisma/client";
import Link from "next/link";
import { Pencil, Play } from "lucide-react";
import { RunSyncButton } from "./RunSyncButton";
import { StatusBadge } from "./StatusBadge";

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
    <div className="panel p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{rule.name}</h3>
            <StatusBadge status={rule.isEnabled ? "connected" : "not_connected"} />
          </div>
          <p className="mt-1.5 text-sm text-muted-fg">
            <span className="text-[var(--text)]">{rule.sourceService}</span>
            <span className="mx-1.5 text-dim-fg">→</span>
            <span className="text-[var(--text)]">{rule.destinations.map((item) => item.service).join(", ")}</span>
            <span className="mx-1.5 text-dim-fg">·</span>
            <span>{modeLabel(rule.mode)}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={`/settings?rule=${rule.id}`} className="btn btn-ghost">
            <Pencil size={16} /> Edit
          </Link>
          <RunSyncButton ruleId={rule.id}>
            <Play size={16} /> Run now
          </RunSyncButton>
        </div>
      </div>

      {progress && progress.sourceTotal > 0 ? (
        <div className="mt-5 space-y-3">
          {progress.destinations.map((dest) => {
            const pct = Math.min(100, Math.round((dest.synced / progress.sourceTotal) * 100));
            const remaining = Math.max(0, progress.sourceTotal - dest.synced);
            const complete = pct >= 100;
            return (
              <div key={`${dest.service}::${dest.playlistId}`} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--text)]">
                    {dest.service}
                    {dest.playlistName ? <span className="text-muted-fg"> · {dest.playlistName}</span> : null}
                  </span>
                  <span className="text-xs text-muted-fg">
                    <span className="text-[var(--text)]">{dest.synced}</span>
                    <span className="text-dim-fg"> / {progress.sourceTotal}</span>
                    {remaining > 0 ? <span className="text-dim-fg"> · {remaining} to go</span> : null}
                    {dest.pendingReview > 0 ? (
                      <span className="ml-1 text-[#fcd34d]">· {dest.pendingReview} need review</span>
                    ) : null}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div
                    className={complete ? "h-full rounded-full bg-emerald-500" : "h-full rounded-full bg-[var(--accent)]"}
                    style={{ width: `${pct}%` }}
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
    </div>
  );
}
