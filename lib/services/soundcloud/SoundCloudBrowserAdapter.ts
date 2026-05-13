import type { MusicServiceAdapter } from "../MusicServiceAdapter";
import type { NormalizedPlaylist, NormalizedTrack, TokenPair, TrackSearchQuery } from "@/lib/sync/syncTypes";
import { cachedSearchTracks } from "@/lib/services/searchCache";
import {
  addSoundCloudTrackToPlaylist,
  createSoundCloudPlaylist,
  listSoundCloudPlaylistTracks,
  listSoundCloudPlaylists,
  removeSoundCloudTrackFromPlaylist,
  searchSoundCloudTracks,
} from "@/worker/runners/soundcloud";

export class SoundCloudBrowserAdapter implements MusicServiceAdapter {
  async getCurrentUser() {
    return { id: "soundcloud_browser_user", username: "SoundCloud" };
  }

  async getPlaylists(): Promise<NormalizedPlaylist[]> {
    const playlists = await listSoundCloudPlaylists();
    return playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      imageUrl: playlist.imageUrl,
      trackCount: playlist.trackCount,
      isWritable: playlist.isWritable === true,
    }));
  }

  async createPlaylist(name: string): Promise<NormalizedPlaylist> {
    const playlist = await createSoundCloudPlaylist(name);
    return {
      id: playlist.id,
      name: playlist.name,
      imageUrl: playlist.imageUrl,
      trackCount: playlist.trackCount,
      isWritable: playlist.isWritable === true,
    };
  }

  async getPlaylistTracks(playlistId: string): Promise<NormalizedTrack[]> {
    return listSoundCloudPlaylistTracks(playlistId);
  }

  async searchTrack(query: TrackSearchQuery): Promise<NormalizedTrack[]> {
    return cachedSearchTracks("soundcloud", query.query, () => searchSoundCloudTracks(query.query));
  }

  async addTrackToPlaylist(playlistId: string, track: NormalizedTrack): Promise<void> {
    const trackId = track.url || track.sourceTrackId;
    await addSoundCloudTrackToPlaylist(playlistId, trackId);
  }

  async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    await removeSoundCloudTrackFromPlaylist(playlistId, trackId);
  }

  async refreshAccessToken(): Promise<TokenPair> {
    return {
      accessToken: "browser-session",
      refreshToken: "browser-session",
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    };
  }

  isConnected(): boolean {
    return true;
  }
}
