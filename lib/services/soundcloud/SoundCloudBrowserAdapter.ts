import type { MusicServiceAdapter } from "../MusicServiceAdapter";
import type { NormalizedPlaylist, NormalizedTrack, TokenPair, TrackSearchQuery } from "@/lib/sync/syncTypes";
import { cachedSearchTracks } from "@/lib/services/searchCache";
import { prisma } from "@/lib/db/prisma";
import {
  invokeSoundCloudAddTrack,
  invokeSoundCloudCreatePlaylist,
  invokeSoundCloudDeletePlaylist,
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
  private readonly healedPlaylistIds = new Map<string, string>();

  constructor(private readonly userId?: string) {}

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
    const writeId = await this.resolveWritePlaylistId(playlistId);
    try {
      await invokeSoundCloudAddTrack(writeId, trackId);
    } catch (error) {
      if (!isSoundCloudPlaylistMissing(error)) throw error;
      const healedId = await this.healMissingDestinationPlaylist(playlistId);
      await invokeSoundCloudAddTrack(healedId, trackId);
    }
  }

  async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    const writeId = await this.resolveWritePlaylistId(playlistId);
    await invokeSoundCloudRemoveTrack(writeId, trackId);
  }

  async deletePlaylist(playlistId: string): Promise<{ deleted: boolean }> {
    const writeId = await this.resolveWritePlaylistId(playlistId);
    return invokeSoundCloudDeletePlaylist(writeId);
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

  private async resolveWritePlaylistId(playlistId: string): Promise<string> {
    return resolveSoundCloudWriteId(this.healedPlaylistIds.get(playlistId) ?? playlistId);
  }

  private async healMissingDestinationPlaylist(oldPlaylistId: string): Promise<string> {
    if (!this.userId) throw new Error(`SoundCloud playlist not found: ${oldPlaylistId}`);
    const cached = this.healedPlaylistIds.get(oldPlaylistId);
    if (cached) return resolveSoundCloudWriteId(cached);

    const oldRow = await prisma.playlist.findUnique({
      where: { service_servicePlaylistId: { service: "SOUNDCLOUD", servicePlaylistId: oldPlaylistId } },
      select: { id: true, userId: true, name: true, createdBySystem: true },
    });
    if (!oldRow || oldRow.userId !== this.userId) {
      throw new Error(`SoundCloud playlist not found: ${oldPlaylistId}`);
    }

    const replacement = await this.createPlaylist(oldRow.name);
    const replacementId = replacement.id;
    await prisma.$transaction(async (tx) => {
      const conflicting = await tx.playlist.findUnique({
        where: { service_servicePlaylistId: { service: "SOUNDCLOUD", servicePlaylistId: replacementId } },
        select: { id: true },
      });
      if (conflicting && conflicting.id !== oldRow.id) {
        await tx.syncDestination.updateMany({
          where: { service: "SOUNDCLOUD", playlistId: oldPlaylistId },
          data: { playlistId: replacementId },
        });
        await tx.playlistGroupMember.updateMany({
          where: { playlistId: oldRow.id },
          data: { playlistId: conflicting.id },
        });
        return;
      }

      await tx.playlist.update({
        where: { id: oldRow.id },
        data: {
          servicePlaylistId: replacementId,
          apiId: replacement.apiId ?? null,
          permalink: replacement.permalink ?? replacementId,
          name: replacement.name,
          imageUrl: replacement.imageUrl ?? null,
          trackCount: replacement.trackCount,
          isWritable: replacement.isWritable ?? true,
          createdBySystem: true,
          lastFetchedAt: new Date(),
        },
      });
      await tx.syncDestination.updateMany({
        where: { service: "SOUNDCLOUD", playlistId: oldPlaylistId },
        data: { playlistId: replacementId },
      });
    });
    this.healedPlaylistIds.set(oldPlaylistId, replacementId);
    console.warn(`[soundcloud-heal] recreated missing destination "${oldRow.name}" (${oldPlaylistId} -> ${replacementId})`);
    return resolveSoundCloudWriteId(replacementId);
  }
}

function isSoundCloudPlaylistMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SoundCloud playlist not found/i.test(message);
}
