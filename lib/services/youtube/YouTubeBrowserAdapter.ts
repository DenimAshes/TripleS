import type { MusicServiceAdapter } from "../MusicServiceAdapter";
import type { NormalizedPlaylist, NormalizedTrack, TokenPair, TrackSearchQuery } from "@/lib/sync/syncTypes";
import { cachedSearchTracks } from "@/lib/services/searchCache";
import {
  invokeYouTubeAddTrack,
  invokeYouTubeCreatePlaylist,
  invokeYouTubeDeletePlaylist,
  invokeYouTubeListPlaylistTracks,
  invokeYouTubeListPlaylists,
  invokeYouTubeRemoveTrack,
  invokeYouTubeSearchTracks,
} from "@/lib/services/runnerInvoker";
import { findYouTubePlaylistByName } from "./youtubePlaylistName";

export class YouTubeBrowserAdapter implements MusicServiceAdapter {
  async getCurrentUser() {
    return { id: "youtube_browser_user", username: "YouTube Music browser session" };
  }

  async getPlaylists(): Promise<NormalizedPlaylist[]> {
    return invokeYouTubeListPlaylists();
  }

  async createPlaylist(name: string, description?: string): Promise<NormalizedPlaylist> {
    try {
      return await invokeYouTubeCreatePlaylist(name, description);
    } catch (createError) {
      const existing = findYouTubePlaylistByName(await invokeYouTubeListPlaylists().catch(() => []), name);
      if (existing) {
        console.warn(
          `[youtube-create] create call failed but playlist "${name}" exists on YouTube Music: ${createError instanceof Error ? createError.message : String(createError)}`,
        );
        return existing;
      }
      throw createError;
    }
  }

  async deletePlaylist(playlistId: string): Promise<{ deleted: boolean }> {
    return invokeYouTubeDeletePlaylist(playlistId);
  }

  async getPlaylistTracks(playlistId: string): Promise<NormalizedTrack[]> {
    return invokeYouTubeListPlaylistTracks(playlistId);
  }

  async searchTrack(query: TrackSearchQuery): Promise<NormalizedTrack[]> {
    return cachedSearchTracks("youtube", query.query, () => invokeYouTubeSearchTracks(query.query), query.isrc);
  }

  async addTrackToPlaylist(playlistId: string, track: NormalizedTrack): Promise<void> {
    const query = `${track.artists.join(" ")} ${track.title}`;
    await invokeYouTubeAddTrack(playlistId, query);
  }

  async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    await invokeYouTubeRemoveTrack(playlistId, trackId);
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
