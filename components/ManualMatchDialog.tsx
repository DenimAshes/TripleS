import type { ManualMatchCandidate, ServiceTrack } from "@prisma/client";
import { ManualMatchActions } from "./ManualMatchActions";

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

// Small inline breakdown so the user can see WHY a match is uncertain —
// e.g. "title 92% · artist 51% · duration ✓". Title/artist mismatches are
// usually the reason; duration is mostly a sanity check.
function MatchBreakdown({ breakdown }: { breakdown?: Record<string, number> }) {
  if (!breakdown) return null;
  const parts: string[] = [];
  if (typeof breakdown.titleScore === "number") parts.push(`title ${Math.round(breakdown.titleScore * 100)}%`);
  if (typeof breakdown.artistScore === "number") parts.push(`artist ${Math.round(breakdown.artistScore * 100)}%`);
  if (typeof breakdown.durationScore === "number") parts.push(`duration ${Math.round(breakdown.durationScore * 100)}%`);
  if (!parts.length) return null;
  return <div className="mt-1 text-xs text-[#666a73]">{parts.join(" · ")}</div>;
}

export function ManualMatchDialog({ item }: { item: ManualCandidateView }) {
  const sourceDuration = formatDuration(item.source?.durationMs);
  return (
    <div className="panel p-4">
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-start">
        <div>
          <div className="text-xs uppercase text-[#666a73]">Original song</div>
          <div className="font-medium">{item.source?.title || item.sourceServiceTrackId}</div>
          <div className="text-sm text-[#666a73]">
            {artists(item.source)}
            {sourceDuration ? <span className="ml-2 text-xs">· {sourceDuration}</span> : null}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-[#666a73]">Possible matches on {item.targetService}</div>
          <div className="mt-2 space-y-2">
            {(item.alternatives?.length ? item.alternatives : item.candidate ? [{ track: item.candidate, confidence: item.confidence, breakdown: undefined as Record<string, number> | undefined }] : []).map((candidate) => {
              const duration = formatDuration(candidate.track.durationMs);
              return (
                <div key={candidate.track.id} className="rounded-md border border-[#deded8] bg-white p-3">
                  <div className="font-medium">{candidate.track.title}</div>
                  <div className="text-sm text-[#666a73]">
                    {artists(candidate.track)}
                    {duration ? <span className="ml-2 text-xs">· {duration}</span> : null}
                  </div>
                  <MatchBreakdown breakdown={candidate.breakdown} />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="text-xs text-[#666a73]">{Math.round(candidate.confidence * 100)}% match</div>
                    <ManualMatchActions id={item.id} serviceTrackId={candidate.track.id} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <ManualMatchActions id={item.id} targetService={item.targetService} />
      </div>
    </div>
  );
}
