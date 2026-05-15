import type {
  NormalizedPlaylist,
  NormalizedTrack,
  ServiceUser,
  TokenPair,
  TrackSearchQuery,
} from "@/lib/sync/syncTypes";

export interface MusicServiceAdapter {
  getCurrentUser(): Promise<ServiceUser>;
  getPlaylists(): Promise<NormalizedPlaylist[]>;
  createPlaylist(name: string, description?: string): Promise<NormalizedPlaylist>;
  getPlaylistTracks(playlistId: string): Promise<NormalizedTrack[]>;
  searchTrack(query: TrackSearchQuery): Promise<NormalizedTrack[]>;
  addTrackToPlaylist(playlistId: string, track: NormalizedTrack): Promise<void>;
  removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void>;
  deletePlaylist?(playlistId: string): Promise<{ deleted: boolean }>;
  refreshAccessToken(): Promise<TokenPair>;
  isConnected(): boolean;
}
