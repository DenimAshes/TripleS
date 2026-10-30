export type SyncJobStats = {
  synced: number;
  alreadySynced: number;
  notFound: number;
  manualRequired: number;
  removed: number;
};

const EMPTY_STATS: SyncJobStats = {
  synced: 0,
  alreadySynced: 0,
  notFound: 0,
  manualRequired: 0,
  removed: 0,
};

export function parseSyncJobStats(value: string): SyncJobStats {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      synced: count(parsed.synced),
      alreadySynced: count(parsed.alreadySynced),
      notFound: count(parsed.notFound),
      manualRequired: count(parsed.manualRequired),
      removed: count(parsed.removed),
    };
  } catch {
    return { ...EMPTY_STATS };
  }
}

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
