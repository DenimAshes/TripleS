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
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-blue-500/10 bg-[#0d0e12]/60 p-6 backdrop-blur-xl">
      {/* Анимированный градиентный фон для кэша */}
      <div className="absolute -left-20 -top-20 h-40 w-40 animate-pulse rounded-full bg-blue-500/5 blur-[60px]" />
      
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative z-10">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400/80">Protocol: Cache Integrity</div>
          <div className="mt-2 text-sm text-slate-400">
            Last scan: <span className="font-mono text-white">{formatRelative(playlist.lastFetchedAt)}</span>
          </div>
        </div>
        <div className="relative z-10 text-right">
          <div className={`text-3xl font-black tabular-nums tracking-tighter ${partial ? "text-amber-400" : "text-blue-400"} drop-shadow-[0_0_10px_rgba(59,130,246,0.3)]`}>
            {activeStates}
            <span className="ml-1 text-lg text-slate-600 font-bold">/{expected || "∞"}</span>
          </div>
        </div>
      </div>
      {expected > 0 ? (
        <div className="relative z-10 mt-5 h-1.5 w-full overflow-hidden rounded-full bg-black/40 border border-white/5">
          <div
            className={`h-full rounded-full transition-all duration-700 ${partial ? "bg-gradient-to-r from-amber-500 to-orange-400" : "bg-gradient-to-r from-blue-600 via-blue-400 to-cyan-300 shadow-[0_0_15px_rgba(59,130,246,0.5)]"}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
