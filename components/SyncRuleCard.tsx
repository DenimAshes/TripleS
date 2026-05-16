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
    <div className="panel p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{rule.name}</h3>
            <StatusBadge status={rule.isEnabled ? "connected" : "not_connected"} />
          </div>
          <p className="mt-1 text-sm text-[#666a73]">
            {rule.sourceService} {"->"} {rule.destinations.map((item) => item.service).join(", ")} / {modeLabel(rule.mode)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/settings?rule=${rule.id}`} className="inline-flex items-center justify-center gap-2 rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm font-medium">
            <Pencil size={16} /> Edit
          </Link>
          <RunSyncButton ruleId={rule.id}>
            <Play size={16} /> Run now
          </RunSyncButton>
        </div>
      </div>

      {progress && progress.sourceTotal > 0 ? (
        <div className="mt-3 space-y-2">
          {progress.destinations.map((dest) => {
            const pct = Math.min(100, Math.round((dest.synced / progress.sourceTotal) * 100));
            const remaining = Math.max(0, progress.sourceTotal - dest.synced);
            return (
              <div key={`${dest.service}::${dest.playlistId}`} className="text-sm">
                <div className="flex items-center justify-between gap-3 text-[#444851]">
                  <span>
                    {dest.service}
                    {dest.playlistName ? <span className="text-[#666a73]"> · {dest.playlistName}</span> : null}
                  </span>
                  <span className="text-xs text-[#666a73]">
                    {dest.synced} / {progress.sourceTotal} synced
                    {remaining > 0 ? <span> · {remaining} to go</span> : null}
                    {dest.pendingReview > 0 ? <span className="text-amber-700"> · {dest.pendingReview} need review</span> : null}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-[#ececec]">
                  <div
                    className={pct >= 100 ? "h-full bg-emerald-500" : "h-full bg-[#18181b]"}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {(lastRunRel || nextRunRel) ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#666a73]">
          {lastRunRel ? <span>Last run: {lastRunRel}</span> : null}
          {nextRunRel ? <span>Next run: {nextRunRel}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
