import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import { normalizeArtist, normalizeTitle } from "@/lib/utils/normalizeTrack";

function words(value: string) {
  return value.split(/\s+/).filter((word) => word.length > 2);
}

export function isDuplicateYouTubeTrack(candidate: NormalizedTrack, playlistTrack: NormalizedTrack, query?: string) {
  if (candidate.sourceTrackId && candidate.sourceTrackId === playlistTrack.sourceTrackId) return true;
  if (candidate.isrc && playlistTrack.isrc && candidate.isrc.toUpperCase() === playlistTrack.isrc.toUpperCase()) return true;

  const candidateTitle = normalizeTitle(candidate.title);
  const playlistTitle = normalizeTitle(playlistTrack.title);
  const candidateArtist = normalizeArtist(candidate.artists[0] || "");
  const playlistArtist = normalizeArtist(playlistTrack.artists[0] || "");
  const normalizedQuery = normalizeTitle(query || "");
  const artistsMatch = Boolean(candidateArtist && playlistArtist && candidateArtist === playlistArtist);
  const titlesMatch = Boolean(candidateTitle && playlistTitle && candidateTitle === playlistTitle);
  const titleContained = Boolean(
    candidateTitle && playlistTitle &&
    (candidateTitle.includes(playlistTitle) || playlistTitle.includes(candidateTitle)),
  );

  if (artistsMatch && (titlesMatch || titleContained)) return true;

  const playlistTitleWords = words(playlistTitle);
  const queryHasTitle = playlistTitleWords.length >= 2 && playlistTitleWords.every((word) => normalizedQuery.includes(word));
  const queryHasArtist = Boolean(playlistArtist && normalizedQuery.includes(playlistArtist));
  return queryHasTitle && (queryHasArtist || artistsMatch);
}
