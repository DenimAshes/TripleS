import type { Playlist } from "@prisma/client";

function formatRelative(date: Date | null | undefined): string {
  if (!date) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function PlaylistDiagnosticsCard({ playlist, activeStates }: { playlist: Playlist; activeStates: number }) {
  const expected = playlist.trackCount ?? 0;
  const partial = expected > 0 && activeStates < expected;
  const ratio = expected > 0 ? Math.min(1, activeStates / expected) : 0;

  return (
    <div className="panel mb-4 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-dim-fg">Track cache</div>
          <div className="mt-0.5 text-xs text-muted-fg">
            Last refreshed <span className="text-[var(--text)]">{formatRelative(playlist.lastFetchedAt)}</span>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold tabular-nums ${partial ? "text-[#fcd34d]" : "text-[var(--text)]"}`}>
            {activeStates}
            <span className="text-dim-fg">/{expected || "-"}</span>
          </div>
          <div className={`text-xs ${partial ? "text-[#fcd34d]" : "text-muted-fg"}`}>
            {partial ? "Partial cache" : `${activeStates} active rows`}
          </div>
        </div>
      </div>
      {expected > 0 ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className={`h-full rounded-full ${partial ? "bg-[#f59e0b]" : "bg-emerald-500"}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
