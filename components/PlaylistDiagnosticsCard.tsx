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
    <div className={`panel mb-4 p-4 text-sm ${partial ? "border-amber-300 bg-amber-50/40" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">Track cache</div>
          <div className="text-xs text-[#666a73]">Last refreshed {formatRelative(playlist.lastFetchedAt)}</div>
        </div>
        <div className="text-right">
          <div className={`text-base font-semibold ${partial ? "text-amber-800" : ""}`}>
            {activeStates}/{expected || "-"} tracks
          </div>
          <div className={`text-xs ${partial ? "text-amber-800" : "text-[#666a73]"}`}>
            {partial ? "Partial cache" : `${activeStates} active rows in DB`}
          </div>
        </div>
      </div>
      {expected > 0 ? (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#f0f0ec]">
          <div
            className={`h-full ${partial ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
