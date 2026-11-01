export function normalizeYouTubePlaylistName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function findYouTubePlaylistByName<T extends { name: string }>(playlists: T[], name: string): T | undefined {
  const target = normalizeYouTubePlaylistName(name);
  return playlists.find((playlist) => normalizeYouTubePlaylistName(playlist.name) === target);
}
