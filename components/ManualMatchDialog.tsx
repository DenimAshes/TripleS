import type { ManualMatchCandidate, ServiceTrack } from "@prisma/client";
import { ManualMatchActions } from "./ManualMatchActions";
import { ServiceIcon, ServicePill } from "./ServiceBrand";

export type ManualCandidateView = ManualMatchCandidate & {
  source?: ServiceTrack | null;
  candidate?: ServiceTrack | null;
  alternatives?: Array<{ track: ServiceTrack; confidence: number; breakdown?: Record<string, number> }>;
};

function artists(track?: ServiceTrack | null) {
  if (!track) return "";
  return (JSON.parse(track.artistsJson) as string[]).join(", ");
}

function formatDuration(ms: number | null | undefined) {
  if (!ms) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function confidenceColor(score: number): string {
  if (score >= 0.85) return "text-emerald-400";
  if (score >= 0.7) return "text-[#fcd34d]";
  return "text-[#fca5a5]";
}

function MatchBreakdown({ breakdown }: { breakdown?: Record<string, number> }) {
  if (!breakdown) return null;
  const parts: Array<{ label: string; pct: number }> = [];
  if (typeof breakdown.titleScore === "number") parts.push({ label: "title", pct: Math.round(breakdown.titleScore * 100) });
  if (typeof breakdown.artistScore === "number") parts.push({ label: "artist", pct: Math.round(breakdown.artistScore * 100) });
  if (typeof breakdown.durationScore === "number") parts.push({ label: "duration", pct: Math.round(breakdown.durationScore * 100) });
  if (!parts.length) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-fg">
      {parts.map((part) => (
        <span key={part.label}>
          {part.label}{" "}
          <span className={part.pct >= 80 ? "text-[var(--text)]" : part.pct >= 55 ? "text-[#fcd34d]" : "text-[#fca5a5]"}>
            {part.pct}%
          </span>
        </span>
      ))}
    </div>
  );
}

export function ManualMatchDialog({ item }: { item: ManualCandidateView }) {
  const sourceDuration = formatDuration(item.source?.durationMs);
  const candidates = item.alternatives?.length
    ? item.alternatives
    : item.candidate
      ? [{ track: item.candidate, confidence: item.confidence, breakdown: undefined as Record<string, number> | undefined }]
      : [];

  return (
    <div className="panel p-6">
      <div className="grid gap-6 md:grid-cols-[1fr_1.5fr_auto] md:items-start">
        <div className="min-w-0 rounded-lg border border-[var(--border-soft)] bg-gradient-to-br from-[var(--surface-2)] to-[var(--surface-3)] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent-fg">
            <ServiceIcon service={item.source?.service || ""} size="sm" className="h-5 w-5 rounded-md" />
            Original song
          </div>
          <div className="mt-3 text-base font-bold leading-snug text-[var(--text)]">{item.source?.title || item.sourceServiceTrackId}</div>
          <div className="mt-2 text-sm text-muted-fg">
            {artists(item.source)}
            {sourceDuration ? <span className="ml-2 text-xs text-dim-fg">/ {sourceDuration}</span> : null}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent-fg">
            Possible matches <ServicePill service={item.targetService} className="ml-2 normal-case tracking-normal" />
          </div>
          <div className="mt-3 space-y-2">
            {candidates.map((candidate) => {
              const duration = formatDuration(candidate.track.durationMs);
              return (
                <div
                  key={candidate.track.id}
                  className="group rounded-lg border border-[var(--border-soft)] bg-gradient-to-r from-[var(--surface-2)] to-transparent p-4 transition duration-200 hover:border-[var(--border-accent)] hover:shadow-[0_0_20px_rgba(79,141,255,0.1)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--text)]">{candidate.track.title}</div>
                      <div className="truncate text-xs text-muted-fg">
                        {artists(candidate.track)}
                        {duration ? <span className="ml-2 text-dim-fg">/ {duration}</span> : null}
                      </div>
                    </div>
                    <div className={`shrink-0 text-sm font-bold tabular-nums ${confidenceColor(candidate.confidence)}`}>
                      {Math.round(candidate.confidence * 100)}%
                    </div>
                  </div>
                  <MatchBreakdown breakdown={candidate.breakdown} />
                  <div className="mt-3 flex justify-end">
                    <ManualMatchActions id={item.id} serviceTrackId={candidate.track.id} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="md:pt-6">
          <ManualMatchActions id={item.id} targetService={item.targetService} />
        </div>
      </div>
    </div>
  );
}
