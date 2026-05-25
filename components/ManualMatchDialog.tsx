import type { ManualMatchCandidate, ServiceTrack } from "@prisma/client";
import { ArrowRight, CheckCircle2, Disc3, ListMusic } from "lucide-react";
import { ManualMatchActions } from "./ManualMatchActions";
import { ServiceIcon, ServicePill } from "./ServiceBrand";
import { TrackPreviewButton } from "./TrackPreviewButton";
import { parseArtistsJson } from "@/lib/utils/parseArtists";

export type ManualCandidateView = ManualMatchCandidate & {
  source?: ServiceTrack | null;
  candidate?: ServiceTrack | null;
  alternatives?: Array<{ track: ServiceTrack; confidence: number; breakdown?: Record<string, number> }>;
};

function artists(track?: ServiceTrack | null) {
  if (!track) return "";
  return parseArtistsJson(track.artistsJson).join(", ");
}

function formatDuration(ms: number | null | undefined) {
  if (!ms) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function confidenceTone(score: number): string {
  if (score >= 0.85) return "text-emerald-300 bg-emerald-500/10 border-emerald-400/20";
  if (score >= 0.7) return "text-amber-200 bg-amber-500/10 border-amber-400/20";
  return "text-rose-200 bg-rose-500/10 border-rose-400/20";
}

function Artwork({ track, size = "lg" }: { track?: ServiceTrack | null; size?: "md" | "lg" }) {
  const cls = size === "lg" ? "h-16 w-16" : "h-12 w-12";
  if (track?.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={track.imageUrl} alt="" className={`${cls} shrink-0 rounded-lg object-cover ring-1 ring-[var(--border-soft)]`} />
    );
  }
  return (
    <div className={`${cls} grid shrink-0 place-items-center rounded-lg bg-[var(--surface-2)] text-dim-fg ring-1 ring-[var(--border-soft)]`}>
      <Disc3 size={size === "lg" ? 24 : 18} strokeWidth={1.6} />
    </div>
  );
}

function MatchBreakdown({ breakdown }: { breakdown?: Record<string, number> }) {
  if (!breakdown) return null;
  const parts: Array<{ label: string; pct: number }> = [];
  if (typeof breakdown.titleScore === "number") parts.push({ label: "title", pct: Math.round(breakdown.titleScore * 100) });
  if (typeof breakdown.artistScore === "number") parts.push({ label: "artist", pct: Math.round(breakdown.artistScore * 100) });
  if (typeof breakdown.durationScore === "number") parts.push({ label: "time", pct: Math.round(breakdown.durationScore * 100) });
  if (!parts.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {parts.map((part) => (
        <span key={part.label} className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] px-1.5 py-0.5 text-[11px] text-muted-fg">
          {part.label} <span className="font-semibold text-[var(--text)]">{part.pct}%</span>
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
    <article className="panel overflow-hidden p-0">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
        <div className="border-b border-[var(--border-soft)] bg-[var(--surface-2)]/65 p-4 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent-fg">
            <ServiceIcon service={item.source?.service || ""} size="sm" className="h-5 w-5 rounded-md" />
            Source
            <ArrowRight size={13} />
            <ServicePill service={item.targetService} className="py-0.5 normal-case tracking-normal" />
          </div>
          <div className="mt-4 flex gap-3">
            <Artwork track={item.source} />
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 text-base font-bold leading-snug text-white">{item.source?.title || item.sourceServiceTrackId}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-muted-fg">{artists(item.source) || "Unknown artist"}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {sourceDuration ? <span className="pill">{sourceDuration}</span> : null}
                {item.source?.url ? (
                  <TrackPreviewButton service={item.source.service} serviceTrackId={item.source.serviceTrackId} url={item.source.url} />
                ) : null}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ListMusic size={15} />
              Resolve once, reuse everywhere
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-fg">
              Accepted picks feed future sync runs for the same song.
            </p>
            <div className="mt-3">
              <ManualMatchActions id={item.id} targetService={item.targetService} />
            </div>
          </div>
        </div>

        <div className="p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-fg">Choose match</div>
            <div className="text-xs text-muted-fg">{candidates.length} candidates</div>
          </div>
          <div className="grid gap-2">
            {candidates.map((candidate, index) => {
              const duration = formatDuration(candidate.track.durationMs);
              const best = index === 0;
              return (
                <div
                  key={candidate.track.id}
                  className={`group rounded-xl border p-3 transition ${
                    best
                      ? "border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] bg-[var(--accent-soft)]/35"
                      : "border-[var(--border-soft)] bg-[var(--surface-2)] hover:border-[var(--border)]"
                  }`}
                >
                  <div className="flex gap-3">
                    <Artwork track={candidate.track} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            {best ? <CheckCircle2 size={15} className="shrink-0 text-emerald-300" /> : null}
                            <h4 className="truncate text-sm font-bold text-white">{candidate.track.title}</h4>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-fg">{artists(candidate.track) || "Unknown artist"}</p>
                        </div>
                        <span className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-black tabular-nums ${confidenceTone(candidate.confidence)}`}>
                          {Math.round(candidate.confidence * 100)}%
                        </span>
                      </div>
                      <MatchBreakdown breakdown={candidate.breakdown} />
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {duration ? <span className="pill">{duration}</span> : null}
                          <TrackPreviewButton
                            service={candidate.track.service}
                            serviceTrackId={candidate.track.serviceTrackId}
                            url={candidate.track.url}
                          />
                        </div>
                        <ManualMatchActions id={item.id} serviceTrackId={candidate.track.id} compact />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {!candidates.length ? (
              <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-5 text-sm text-muted-fg">
                No candidates were stored for this song. Paste a direct link or skip it.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
