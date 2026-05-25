import { CheckCircle2, Database, Loader2, RefreshCw } from "lucide-react";
import type { Playlist } from "@prisma/client";

function formatRelative(date: Date | null | undefined): string {
  if (!date) return "never";
  return date.toLocaleString();
}

export function PlaylistDiagnosticsCard({ playlist, activeStates }: { playlist: Playlist; activeStates: number }) {
  const expected = playlist.trackCount ?? 0;
  const partial = expected > 0 && activeStates < expected;
  const ratio = expected > 0 ? Math.min(1, activeStates / expected) : 0;
  const percent = Math.round(ratio * 100);
  const status = expected === 0 ? "No saved track count yet" : partial ? "Still filling the local cache" : "Track cache is complete";
  const remaining = Math.max(0, expected - activeStates);

  // Healthy cache == nothing actionable here. Collapse to a one-line
  // pill so the page doesn't burn a whole panel on "everything is fine".
  if (!partial && expected > 0) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-fg">
        <span className="pill pill-success">
          <CheckCircle2 size={12} />
          Cache complete · {activeStates} tracks · scanned {formatRelative(playlist.lastFetchedAt)}
        </span>
      </div>
    );
  }

  return (
    <section
      className="panel group surface-lift animated-sheen relative mb-6 overflow-hidden p-5 sm:p-6"
      aria-label="Playlist cache diagnostics"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-70" />
      <div
        className={`pointer-events-none absolute -left-20 -top-20 h-44 w-44 rounded-full blur-[70px] transition duration-500 ${
          partial ? "bg-amber-500/15" : "bg-[var(--accent)]/12"
        } group-hover:scale-110`}
      />

      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-accent-fg">
            <Database size={12} />
            Playlist cache
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
            {partial ? (
              <Loader2 size={14} className="animate-spin text-amber-300" />
            ) : expected === 0 ? (
              <RefreshCw size={14} className="text-dim-fg" />
            ) : (
              <CheckCircle2 size={14} className="text-emerald-300" />
            )}
            {status}
          </div>
          <div className="mt-2 text-sm text-muted-fg">
            Last scan:{" "}
            <span className="font-mono text-[var(--text)]">{formatRelative(playlist.lastFetchedAt)}</span>
            {remaining > 0 ? (
              <span className="ml-3 text-dim-fg">
                / <span className="tabular-nums text-amber-200">{remaining}</span> still to load
              </span>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          <div
            className={`text-3xl font-black tabular-nums tracking-tighter ${
              partial ? "text-amber-300" : "text-[var(--accent)]"
            } drop-shadow-[0_0_10px_var(--accent-glow)] md:text-4xl`}
          >
            {activeStates}
            <span className="ml-1 text-lg font-bold text-dim-fg">/ {expected || "-"}</span>
          </div>
          {expected > 0 ? (
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-dim-fg tabular-nums">
              {percent}% cached
            </div>
          ) : null}
        </div>
      </div>
      {expected > 0 ? (
        <div className="relative mt-5">
          <div className="h-2 w-full overflow-hidden rounded-full border border-white/5 bg-black/40">
            <div
              className={`dist-bar-fill h-full rounded-full transition-[width] duration-700 ${
                partial
                  ? "bg-gradient-to-r from-amber-500 to-orange-400 shadow-[0_0_14px_rgba(245,158,11,0.45)]"
                  : "bg-gradient-to-r from-[var(--accent)] via-[var(--accent-hover)] to-emerald-300 shadow-[0_0_18px_var(--accent-glow)]"
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
