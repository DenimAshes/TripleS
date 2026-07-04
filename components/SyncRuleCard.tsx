import type { SyncDestination, SyncRule } from "@prisma/client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Pencil, Play, RadioTower } from "lucide-react";
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
  const nextRunRel = rule.isEnabled ? formatRelative(rule.nextRunAt) : null;
  const sourceMeta = serviceMeta(rule.sourceService);
  const glow =
    sourceMeta.key === "SPOTIFY"
      ? "service-glow-spotify"
      : sourceMeta.key === "YOUTUBE"
        ? "service-glow-youtube"
        : sourceMeta.key === "SOUNDCLOUD"
          ? "service-glow-soundcloud"
          : "";
  const running = Boolean(runningJob);
  const activeDestinations = rule.destinations.filter((destination) => destination.isEnabled);
  const latestFailed = latestJob?.status === "FAILED" || latestJob?.status === "PARTIAL_SUCCESS";
  const routeState = running
    ? { icon: <Clock3 size={14} />, label: "Running", className: "pill-accent" }
    : latestFailed
      ? { icon: <AlertTriangle size={14} />, label: latestJob.status === "PARTIAL_SUCCESS" ? "Partial" : "Issue", className: "text-[#fca5a5]" }
      : rule.isEnabled
        ? { icon: <RadioTower size={14} />, label: "Listening", className: "text-emerald-300" }
        : { icon: <AlertTriangle size={14} />, label: "Off", className: "text-muted-fg" };

  return (
    <div
      className={`panel group surface-lift animated-sheen ${glow} relative overflow-hidden p-6 ${sourceMeta.border} ${running ? "shadow-[0_28px_70px_-46px_var(--accent-glow)]" : ""}`}
    >
      <span
        className={`pointer-events-none absolute inset-y-4 left-0 w-1 rounded-full ${sourceMeta.bg} transition duration-300 ${running ? "opacity-100" : "opacity-60 group-hover:opacity-100"}`}
      />
      <div className={`pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full ${sourceMeta.bg} opacity-10 blur-[80px] transition duration-500 group-hover:opacity-20`} />
      {running ? (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />
      ) : null}

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <ServiceIcon service={rule.sourceService} size="sm" className="transition duration-200 group-hover:scale-105" />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-dim-fg">Source route</div>
              <h3 className="truncate text-lg font-bold tracking-tight text-white">{rule.name}</h3>
            </div>
            <StatusBadge status={rule.isEnabled ? "connected" : "not_connected"} />
            <span className={`pill ${routeState.className}`}>
              {running ? (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                </span>
              ) : (
                routeState.icon
              )}
              {routeState.label}
            </span>
          </div>

          <div className="mt-4 grid gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)]/45 p-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.35fr)] md:items-center">
            <div className="min-w-0">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-dim-fg">Listen from</div>
              <ServicePill service={rule.sourceService} className="max-w-full" />
            </div>
            <ArrowRight size={16} className="hidden text-dim-fg md:block" />
            <div className="min-w-0">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-dim-fg">
                Apply to {activeDestinations.length} destination{activeDestinations.length === 1 ? "" : "s"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeDestinations.map((item) => (
                  <ServicePill key={`${item.service}-${item.playlistId}`} service={item.service} className="rounded-lg py-0.5" />
                ))}
                {!activeDestinations.length ? <span className="pill text-[#fca5a5]">No destinations</span> : null}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="pill">{modeLabel(rule.mode)}</span>
            {latestJob ? (
              <span className={`pill ${latestFailed ? "text-[#fca5a5]" : latestJob.status === "SUCCEEDED" ? "text-emerald-300" : ""}`}>
                {latestFailed ? <AlertTriangle size={13} /> : latestJob.status === "SUCCEEDED" ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
                Last {latestJob.status.toLowerCase().replaceAll("_", " ")}
              </span>
            ) : null}
          </div>
          {latestFailed && latestJob?.errorMessage ? (
            <div className="mt-2 truncate rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-200" title={latestJob.errorMessage}>
              {latestJob.errorMessage}
            </div>
          ) : null}
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
            const destMeta = serviceMeta(dest.service);
            return (
              <div key={`${dest.service}::${dest.playlistId}`} className="text-sm">
                <div className="mb-2 flex items-end justify-between gap-3">
                  <span className="min-w-0 text-xs font-bold text-slate-300">
                    <span className="inline-flex max-w-full items-center gap-2">
                      <ServiceIcon service={dest.service} size="sm" className="h-5 w-5 rounded-md" />
                      <span className="shrink-0">{destMeta.label}</span>
                      {dest.playlistName ? <span className="truncate text-slate-500 font-medium">/ {dest.playlistName}</span> : null}
                      {complete ? <span className="pill pill-success shrink-0">Done</span> : null}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-normal text-slate-500">
                    <span className="text-white tabular-nums">{dest.synced}</span>
                    <span className="mx-1">/</span>
                    <span className="tabular-nums">{progress.sourceTotal}</span>
                    {remaining > 0 ? <span className="ml-2 text-[var(--accent)]/70">{remaining} left</span> : null}
                    {dest.pendingReview > 0 ? <span className="ml-2 text-[#fcd34d]">/ {dest.pendingReview} review</span> : null}
                  </span>
                </div>
                <div className="relative h-1.5 overflow-hidden rounded-full border border-white/5 bg-black/40">
                  <div
                    className={
                      complete
                        ? "h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.4)]"
                        : `h-full rounded-full ${destMeta.bg} shadow-[0_0_14px_var(--accent-glow)]`
                    }
                    style={{ width: `${pct}%`, transition: "width 500ms cubic-bezier(0.4, 0, 0.2, 1)" }}
                  />
                  {running && !complete ? (
                    <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[sheen-pass_1.6s_ease-out_infinite]" />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {lastRunRel || nextRunRel ? (
        <div className="relative mt-4 flex flex-wrap items-center gap-2 text-xs">
          {lastRunRel ? (
            <span className="pill">
              Last <span className="ml-1 text-[var(--text)]">{lastRunRel}</span>
            </span>
          ) : null}
          {nextRunRel ? (
            <span className="pill pill-accent">
              Next <span className="ml-1 text-[var(--text)]">{nextRunRel}</span>
            </span>
          ) : null}
          {rule.intervalMinutes ? (
            <span className="pill">every {rule.intervalMinutes}m</span>
          ) : null}
        </div>
      ) : null}

      <div className="relative">
        <SyncRuleHistory ruleId={rule.id} />
      </div>
    </div>
  );
}
