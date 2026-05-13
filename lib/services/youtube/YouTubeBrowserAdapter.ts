import type { MusicServiceAdapter } from "../MusicServiceAdapter";
import type { NormalizedPlaylist, NormalizedTrack, TokenPair, TrackSearchQuery } from "@/lib/sync/syncTypes";
import { cachedSearchTracks } from "@/lib/services/searchCache";
import {
  addFirstSearchResultToPlaylistCli,
  listYouTubePlaylistTracksCli,
  listYouTubePlaylistsCli,
  removeTrackFromPlaylistCli,
  searchYouTubeTracksCli,
} from "./youtubeBrowserCli";

export class YouTubeBrowserAdapter implements MusicServiceAdapter {
  async getCurrentUser() {
    return { id: "youtube_browser_user", username: "YouTube Music browser session" };
  }

  async getPlaylists(): Promise<NormalizedPlaylist[]> {
    const playlists = await listYouTubePlaylistsCli();
    return playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      imageUrl: playlist.imageUrl,
      trackCount: playlist.trackCount,
      isWritable: true,
    }));
  }

  async createPlaylist(): Promise<NormalizedPlaylist> {
    throw new Error("Creating YouTube Music playlists from this app is not available yet.");
  }

  async getPlaylistTracks(playlistId: string): Promise<NormalizedTrack[]> {
    return listYouTubePlaylistTracksCli(playlistId);
  }

  async searchTrack(query: TrackSearchQuery): Promise<NormalizedTrack[]> {
    return cachedSearchTracks("youtube", query.query, () => searchYouTubeTracksCli(query.query));
  }

  async addTrackToPlaylist(playlistId: string, track: NormalizedTrack): Promise<void> {
    const query = `${track.artists.join(" ")} ${track.title}`;
    await addFirstSearchResultToPlaylistCli(playlistId, query);
  }

  async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    await removeTrackFromPlaylistCli(playlistId, trackId);
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
