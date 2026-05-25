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
