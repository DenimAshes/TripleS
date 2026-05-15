import type { MusicServiceAdapter } from "../MusicServiceAdapter";
import type { NormalizedPlaylist, NormalizedTrack, TokenPair, TrackSearchQuery } from "@/lib/sync/syncTypes";
import { cachedSearchTracks } from "@/lib/services/searchCache";
import { prisma } from "@/lib/db/prisma";
import {
  invokeSoundCloudAddTrack,
  invokeSoundCloudCreatePlaylist,
  invokeSoundCloudListPlaylistTracks,
  invokeSoundCloudListPlaylists,
  invokeSoundCloudRemoveTrack,
  invokeSoundCloudSearchTracks,
} from "@/lib/services/runnerInvoker";

async function resolveSoundCloudWriteId(servicePlaylistId: string): Promise<string> {
  if (/^\d+$/.test(servicePlaylistId)) return servicePlaylistId;
  // Private playlists are addressed as "user/sets/slug/s-secretToken". The
  // numeric apiId alone hits a 404 because /playlists/{id} requires the
  // secret_token query param for non-public playlists, but /resolve?url=...
  // accepts the full permalink with embedded secret. Keep the permalink form
  // whenever it carries a /s- segment so writes don't lose access.
  if (servicePlaylistId.includes("/s-")) return servicePlaylistId;
  const row = await prisma.playlist
    .findUnique({
      where: { service_servicePlaylistId: { service: "SOUNDCLOUD", servicePlaylistId } },
      select: { apiId: true },
    })
    .catch(() => null);
  return row?.apiId || servicePlaylistId;
}

export class SoundCloudBrowserAdapter implements MusicServiceAdapter {
  async getCurrentUser() {
    return { id: "soundcloud_browser_user", username: "SoundCloud" };
  }

  async getPlaylists(): Promise<NormalizedPlaylist[]> {
    return invokeSoundCloudListPlaylists();
  }

  async createPlaylist(name: string): Promise<NormalizedPlaylist> {
    const normalize = (value: string) => value.trim().toLowerCase();
    const target = normalize(name);

    try {
      return await invokeSoundCloudCreatePlaylist(name);
    } catch (createError) {
      const afterFailure = await invokeSoundCloudListPlaylists().catch(() => []);
      const matchAfter = afterFailure.find((playlist) => normalize(playlist.name) === target);
      if (matchAfter) {
        console.warn(
          `[soundcloud-create] create call failed but playlist "${name}" exists on SoundCloud (idempotent resolution): ${createError instanceof Error ? createError.message : String(createError)}`,
        );
        return matchAfter;
      }
      throw createError;
    }
  }

  async getPlaylistTracks(playlistId: string): Promise<NormalizedTrack[]> {
    return invokeSoundCloudListPlaylistTracks(playlistId);
  }

  async searchTrack(query: TrackSearchQuery): Promise<NormalizedTrack[]> {
    return cachedSearchTracks("soundcloud", query.query, () => invokeSoundCloudSearchTracks(query.query), query.isrc);
  }

  async addTrackToPlaylist(playlistId: string, track: NormalizedTrack): Promise<void> {
    const trackId = track.url || track.sourceTrackId;
    const writeId = await resolveSoundCloudWriteId(playlistId);
    await invokeSoundCloudAddTrack(writeId, trackId);
  }

  async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    const writeId = await resolveSoundCloudWriteId(playlistId);
    await invokeSoundCloudRemoveTrack(writeId, trackId);
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
