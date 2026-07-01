import { parseArtistsJson } from "@/lib/utils/parseArtists";

export class ManualMatchRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ManualMatchRequestError";
  }
}

export function parseBulkThreshold(value: unknown, fallback: number): number {
  if (value == null) return fallback;
  const threshold = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new ManualMatchRequestError(400, "Threshold must be between 0 and 1.");
  }
  return threshold;
}

export function parsePreviewFlag(value: unknown): boolean {
  return value === true || value === "true";
}

export type ManualMatchAlternative = {
  serviceTrackId: string;
  confidence: number;
  breakdown?: Record<string, number>;
};

export type ManualMatchPreviewCandidate = {
  id: string;
  confidence: number;
  sourceServiceTrackId: string;
  sourceService?: string;
  sourceTitle?: string;
  sourceArtists?: string[];
  candidateServiceTrackId: string;
  candidateService?: string;
  candidateTitle?: string;
  candidateArtists?: string[];
  targetService: string;
};

function isBreakdown(value: unknown): value is Record<string, number> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Object.values(value as Record<string, unknown>).every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

export function parseManualMatchAlternatives(value: string | null | undefined): ManualMatchAlternative[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: ManualMatchAlternative[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const serviceTrackId = typeof raw.serviceTrackId === "string" ? raw.serviceTrackId : "";
    const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : null;
    if (!serviceTrackId || confidence == null || confidence < 0 || confidence > 1 || seen.has(serviceTrackId)) continue;
    seen.add(serviceTrackId);
    out.push({
      serviceTrackId,
      confidence,
      breakdown: isBreakdown(raw.breakdown) ? raw.breakdown : undefined,
    });
  }
  return out;
}

export function buildManualMatchPreviewCandidates<
  T extends {
    id: string;
    confidence: number;
    sourceServiceTrackId: string;
    candidateServiceTrackId: string;
    targetService: string;
  },
>(
  candidates: T[],
  tracksById: Map<string, { service: string; title: string; artistsJson: string }>,
): ManualMatchPreviewCandidate[] {
  return candidates.map((candidate) => {
    const source = tracksById.get(candidate.sourceServiceTrackId);
    const target = tracksById.get(candidate.candidateServiceTrackId);
    return {
      id: candidate.id,
      confidence: candidate.confidence,
      sourceServiceTrackId: candidate.sourceServiceTrackId,
      sourceService: source?.service,
      sourceTitle: source?.title,
      sourceArtists: source ? parseArtistsJson(source.artistsJson) : undefined,
      candidateServiceTrackId: candidate.candidateServiceTrackId,
      candidateService: target?.service,
      candidateTitle: target?.title,
      candidateArtists: target ? parseArtistsJson(target.artistsJson) : undefined,
      targetService: candidate.targetService,
    };
  });
}
