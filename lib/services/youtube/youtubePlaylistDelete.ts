export function youtubePlaylistDeleteBlocker(input: {
  groupMemberships: number;
  sourceRules: number;
  destinationRules: number;
}): string | null {
  if (input.groupMemberships > 0) return "Disconnect this playlist group before deleting it.";
  if (input.sourceRules > 0 || input.destinationRules > 0) {
    return "Remove this playlist from its sync rules before deleting it.";
  }
  return null;
}
