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
  if (score >= 0.85) return "text-success-fg bg-success/10 border-success/20";
  if (score >= 0.7) return "text-warning-fg bg-warning/10 border-warning/20";
  return "text-danger-fg bg-danger/10 border-danger/20";
}

function Artwork({ track, size = "lg" }: { track?: ServiceTrack | null; size?: "md" | "lg" }) {
  const cls = size === "lg" ? "h-16 w-16" : "h-12 w-12";
  if (track?.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={track.imageUrl} alt="" className={`${cls} shrink-0 rounded-[var(--radius-sm)] object-cover ring-1 ring-[var(--border-soft)]`} />
    );
  }
  return (
    <div className={`${cls} grid shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-dim-fg ring-1 ring-[var(--border-soft)]`}>
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
        <span key={part.label} className="rounded-[var(--radius-sm)] border border-[var(--border-soft)] bg-[var(--surface)] px-1.5 py-0.5 text-xs text-muted-fg">
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
    <article className="overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
        <div className="border-b border-[var(--border-soft)] bg-[var(--surface-2)]/65 p-4 lg:border-b-0 lg:border-r">
          <div className="eyebrow flex items-center gap-2">
            <ServiceIcon service={item.source?.service || ""} size="sm" className="h-5 w-5 rounded-[var(--radius-sm)]" />
            Source
            <ArrowRight size={13} />
            <ServicePill service={item.targetService} className="py-0.5 normal-case tracking-normal" />
          </div>
          <div className="mt-4 flex gap-3">
            <Artwork track={item.source} />
            <div className="min-w-0 flex-1">
              <h3 className="heading-panel line-clamp-2 leading-snug">{item.source?.title || item.sourceServiceTrackId}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-muted-fg">{artists(item.source) || "Unknown artist"}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {sourceDuration ? <span className="pill">{sourceDuration}</span> : null}
                {item.source?.url ? (
                  <TrackPreviewButton service={item.source.service} serviceTrackId={item.source.serviceTrackId} url={item.source.url} />
                ) : null}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--border-soft)] bg-[var(--surface)] p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
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
            <div className="eyebrow">Choose match</div>
            <div className="text-xs text-muted-fg">{candidates.length} candidates</div>
          </div>
          {/* Divided rows, not five framed cards. Each candidate already ends
              in its own Use/Skip pair, so the frame was not the affordance -
              and five of them inside one review row was the last place in the
              app drawing a box inside a box. The top pick keeps a tint, which
              is the one thing the frame was actually carrying. */}
          <div className="rows">
            {candidates.map((candidate, index) => {
              const duration = formatDuration(candidate.track.durationMs);
              const best = index === 0;
              return (
                <div
                  key={candidate.track.id}
                  className={`group rounded-[var(--radius-sm)] px-2 py-3 transition ${
                    best ? "bg-[var(--accent-soft)]/35" : "hover:bg-[var(--surface-2)]/60"
                  }`}
                >
                  <div className="flex gap-3">
                    <Artwork track={candidate.track} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--border-soft)] bg-[var(--surface)] text-xs font-semibold text-muted-fg"
                              title={`Pick ${index + 1}`}
                            >
                              {index + 1}
                            </span>
                            {best ? <CheckCircle2 size={15} className="shrink-0 text-success-fg" /> : null}
                            <h4 className="heading-row truncate">{candidate.track.title}</h4>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-fg">{artists(candidate.track) || "Unknown artist"}</p>
                        </div>
                        <span className={`shrink-0 rounded-[var(--radius-sm)] border px-2 py-1 text-xs font-semibold tabular-nums ${confidenceTone(candidate.confidence)}`}>
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
              <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface-2)] p-5 text-sm text-muted-fg">
                No candidates were stored for this song. Paste a direct link or skip it.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
