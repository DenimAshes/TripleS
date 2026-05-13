import type { ManualMatchCandidate, ServiceTrack } from "@prisma/client";
import { ManualMatchActions } from "./ManualMatchActions";

export type ManualCandidateView = ManualMatchCandidate & {
  source?: ServiceTrack | null;
  candidate?: ServiceTrack | null;
  alternatives?: Array<{ track: ServiceTrack; confidence: number }>;
};

function artists(track?: ServiceTrack | null) {
  if (!track) return "";
  return (JSON.parse(track.artistsJson) as string[]).join(", ");
}

export function ManualMatchDialog({ item }: { item: ManualCandidateView }) {
  return (
    <div className="panel p-4">
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-start">
        <div>
          <div className="text-xs uppercase text-[#666a73]">Original song</div>
          <div className="font-medium">{item.source?.title || item.sourceServiceTrackId}</div>
          <div className="text-sm text-[#666a73]">{artists(item.source)}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-[#666a73]">Possible matches on {item.targetService}</div>
          <div className="mt-2 space-y-2">
            {(item.alternatives?.length ? item.alternatives : item.candidate ? [{ track: item.candidate, confidence: item.confidence }] : []).map((candidate) => (
              <div key={candidate.track.id} className="rounded-md border border-[#deded8] bg-white p-3">
                <div className="font-medium">{candidate.track.title}</div>
                <div className="text-sm text-[#666a73]">{artists(candidate.track)}</div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-xs text-[#666a73]">{Math.round(candidate.confidence * 100)}% match</div>
                  <ManualMatchActions id={item.id} serviceTrackId={candidate.track.id} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <ManualMatchActions id={item.id} targetService={item.targetService} />
      </div>
    </div>
  );
}
