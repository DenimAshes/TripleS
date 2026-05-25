export type BatchableSyncRule = {
  id: string;
  sourceService: string;
  sourcePlaylistId?: string | null;
};

export type SourcePlaylistGroupMember = {
  groupId: string;
  playlist: {
    service: string;
    servicePlaylistId: string;
  };
};

export type GroupAwareLimitResult<T extends BatchableSyncRule> = {
  selected: T[];
  skipped: T[];
};

export function sourcePlaylistKey(service: string, playlistId: string): string {
  return `${service.toUpperCase()}:${playlistId}`;
}

export function buildSourcePlaylistGroupMap(members: SourcePlaylistGroupMember[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const member of members) {
    map.set(sourcePlaylistKey(member.playlist.service, member.playlist.servicePlaylistId), member.groupId);
  }
  return map;
}

export function ruleBatchKey(rule: BatchableSyncRule, groupBySourcePlaylist: Map<string, string>): string {
  if (!rule.sourcePlaylistId) return `rule:${rule.id}`;
  const groupId = groupBySourcePlaylist.get(sourcePlaylistKey(rule.sourceService, rule.sourcePlaylistId));
  return groupId ? `group:${groupId}` : `rule:${rule.id}`;
}

export function applyGroupAwareRuleLimit<T extends BatchableSyncRule>(
  rules: T[],
  groupBySourcePlaylist: Map<string, string>,
  maxBatches: number,
): GroupAwareLimitResult<T> {
  if (!Number.isFinite(maxBatches) || maxBatches <= 0) {
    return { selected: rules, skipped: [] };
  }

  const selectedBatchKeys = new Set<string>();
  for (const rule of rules) {
    const key = ruleBatchKey(rule, groupBySourcePlaylist);
    if (!selectedBatchKeys.has(key)) {
      if (selectedBatchKeys.size >= maxBatches) break;
      selectedBatchKeys.add(key);
    }
  }

  const selected: T[] = [];
  const skipped: T[] = [];
  for (const rule of rules) {
    const bucket = selectedBatchKeys.has(ruleBatchKey(rule, groupBySourcePlaylist)) ? selected : skipped;
    bucket.push(rule);
  }

  return { selected, skipped };
}
