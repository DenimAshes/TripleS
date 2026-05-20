import type { MusicServiceAdapter } from "../MusicServiceAdapter";
import type {
  NormalizedPlaylist,
  NormalizedTrack,
  ServiceUser,
  TokenPair,
  TrackSearchQuery,
} from "@/lib/sync/syncTypes";
import { decryptToken, encryptToken } from "@/lib/crypto/tokenEncryption";
import { prisma } from "@/lib/db/prisma";
import { spotifyBasicAuthHeader } from "./spotifyAuth";
import { getSpotifyWebCookie } from "./spotifyCookieStore";
import {
  webGetMe,
  webGetMyPlaylists,
  webGetPlaylistTracks,
  webSearchTrack,
} from "./spotifyWebClient";
import type {
  SpotifyPaged,
  SpotifyImage,
  SpotifyPlaylist,
  SpotifyPlaylistTrackItem,
  SpotifyTrack,
  SpotifyUser,
} from "./spotifyTypes";

const API_BASE = "https://api.spotify.com/v1";
const PAGE_LIMIT = 50;
const TRACK_IMAGE_TARGET_SIZE = 64;

function pickSpotifyImage(images?: SpotifyImage[]): string | undefined {
  if (!Array.isArray(images) || images.length === 0) return undefined;
  const withSize = images
    .filter((image) => image?.url)
    .map((image) => ({ ...image, size: Math.max(image.width ?? 0, image.height ?? 0) }))
    .sort((a, b) => a.size - b.size);
  return (
    withSize.find((image) => image.size >= TRACK_IMAGE_TARGET_SIZE)?.url ||
    withSize[withSize.length - 1]?.url
  );
}

function normalizeSpotifyTrack(track: SpotifyTrack): NormalizedTrack {
  return {
    title: track.name,
    artists: track.artists?.map((artist) => artist.name) || [],
    album: track.album?.name,
    durationMs: track.duration_ms,
    isrc: track.external_ids?.isrc,
    sourceService: "spotify",
    sourceTrackId: track.id,
    url: track.external_urls?.spotify,
    imageUrl: pickSpotifyImage(track.album?.images),
  };
}

function spotifyPlaylistTrackCount(playlist: SpotifyPlaylist): number {
  return playlist.tracks?.total ?? playlist.items?.total ?? 0;
}

function canModifySpotifyPlaylist(playlist: SpotifyPlaylist, ownerId?: string | null): boolean {
  return Boolean((ownerId && playlist.owner?.id === ownerId) || playlist.collaborative);
}

export class SpotifyAdapter implements MusicServiceAdapter {
  private accessTokenCache: { token: string; expiresAt: number | null } | null = null;

  constructor(private userId?: string) {}

  private async getAccount() {
    if (!this.userId) return null;
    return prisma.connectedAccount.findUnique({
      where: { userId_service: { userId: this.userId, service: "SPOTIFY" } },
    });
  }

  private async getAccessToken() {
    if (
      this.accessTokenCache &&
      (!this.accessTokenCache.expiresAt || this.accessTokenCache.expiresAt - Date.now() > 60_000)
    ) {
      return this.accessTokenCache.token;
    }

    const account = await this.getAccount();
    if (!account || account.isMock) {
      throw new Error("Spotify account is not connected");
    }

    const shouldRefresh = account.expiresAt && account.expiresAt.getTime() - Date.now() < 60_000;
    if (!shouldRefresh) {
      const token = decryptToken(account.accessTokenEncrypted);
      this.accessTokenCache = { token, expiresAt: account.expiresAt?.getTime() ?? null };
      return token;
    }

    const refreshed = await this.refreshAccessToken();
    this.accessTokenCache = { token: refreshed.accessToken, expiresAt: refreshed.expiresAt?.getTime() ?? null };
    return refreshed.accessToken;
  }

  private async request<T>(pathOrUrl: string, init?: RequestInit): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Spotify API ${response.status}: ${body}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async fetchAllPages<T>(firstPath: string): Promise<T[]> {
    const items: T[] = [];
    let nextUrl: string | null = firstPath;
    while (nextUrl) {
      const page: SpotifyPaged<T> = await this.request<SpotifyPaged<T>>(nextUrl);
      if (Array.isArray(page.items)) items.push(...page.items);
      nextUrl = page.next || null;
    }
    return items;
  }

  private async getWebCookie(): Promise<string | null> {
    if (!this.userId) return null;
    return getSpotifyWebCookie(this.userId);
  }

  async getCurrentUser(): Promise<ServiceUser> {
    const cookie = await this.getWebCookie();
    if (cookie) {
      return webGetMe(cookie);
    }
    const user = await this.request<SpotifyUser>("/me");
    return {
      id: user.id,
      username: user.display_name || user.email || user.id,
    };
  }

  async getPlaylists(): Promise<NormalizedPlaylist[]> {
    const cookie = await this.getWebCookie();
    if (cookie) {
      return webGetMyPlaylists(cookie);
    }
    const account = await this.getAccount();
    const ownerId = account?.serviceUserId;
    const playlists = await this.fetchAllPages<SpotifyPlaylist>(`/me/playlists?limit=${PAGE_LIMIT}`);
    return playlists
      .filter((playlist) => canModifySpotifyPlaylist(playlist, ownerId))
      .map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description || undefined,
        imageUrl: playlist.images?.[0]?.url,
        trackCount: spotifyPlaylistTrackCount(playlist),
        isWritable: true,
      }));
  }

  async createPlaylist(name: string, description?: string): Promise<NormalizedPlaylist> {
    await this.ensureWriteAuth();
    const account = await this.getAccount();
    const userId = account?.serviceUserId || (await this.request<SpotifyUser>("/me")).id;
    const playlist = await this.request<SpotifyPlaylist>(`/users/${encodeURIComponent(userId)}/playlists`, {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description || "",
        public: false,
      }),
    });

    return {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description || undefined,
      imageUrl: playlist.images?.[0]?.url,
      trackCount: spotifyPlaylistTrackCount(playlist),
      isWritable: true,
    };
  }

  async getPlaylistTracks(playlistId: string): Promise<NormalizedTrack[]> {
    const cookie = await this.getWebCookie();
    if (cookie) {
      return webGetPlaylistTracks(cookie, playlistId);
    }
    const fields = "items(item(id,uri,name,duration_ms,external_ids,external_urls,album(name,images),artists(name))),next,total";
    const items = await this.fetchAllPages<SpotifyPlaylistTrackItem>(
      `/playlists/${encodeURIComponent(playlistId)}/items?limit=${PAGE_LIMIT}&fields=${encodeURIComponent(fields)}`,
    );
    return items
      .map((item) => item.track ?? item.item)
      .filter((track): track is SpotifyTrack => Boolean(track?.id))
      .map(normalizeSpotifyTrack);
  }

  async searchTrack(query: TrackSearchQuery): Promise<NormalizedTrack[]> {
    const sanitize = (value: string) =>
      value
        .replace(/[":()\[\]\\]/g, " ")
        .replace(/\b(and|or|not)\b/gi, " ")
        .replace(/[-+!^~*?]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const quoted = (value: string) => `"${sanitize(value)}"`;
    const structuredParts: string[] = [];
    if (query.title) {
      const cleaned = sanitize(query.title);
      if (cleaned) structuredParts.push(`track:${quoted(cleaned)}`);
    }
    if (query.artist) {
      const cleaned = sanitize(query.artist);
      if (cleaned) structuredParts.push(`artist:${quoted(cleaned)}`);
    }
    const q = query.isrc
      ? `isrc:${query.isrc}`
      : structuredParts.length
        ? structuredParts.join(" ")
        : sanitize(query.query) || query.query;
    const cookie = await this.getWebCookie();
    if (cookie) {
      return webSearchTrack(cookie, q);
    }
    const data = await this.request<{ tracks: SpotifyPaged<SpotifyTrack> }>(
      `/search?type=track&limit=10&q=${encodeURIComponent(q)}`,
    );
    return data.tracks.items.map(normalizeSpotifyTrack);
  }

  private async ensureWriteAuth() {
    const account = await this.getAccount();
    if (!account || !account.accessTokenEncrypted) {
      throw new Error(
        "Writing to Spotify requires OAuth (Premium-owner app). Cookie-only mode supports read only — track sync to Spotify is disabled.",
      );
    }
  }

  async addTrackToPlaylist(playlistId: string, track: NormalizedTrack): Promise<void> {
    await this.ensureWriteAuth();
    const spotifyTrackId = track.sourceService === "spotify" ? track.sourceTrackId : undefined;
    if (!spotifyTrackId) {
      const [match] = await this.searchTrack({
        query: `${track.title} ${track.artists[0] || ""}`,
        isrc: track.isrc,
      });
      if (!match) throw new Error(`Spotify match not found for ${track.title}`);
      await this.addTrackToPlaylist(playlistId, match);
      return;
    }

    await this.request(`/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: "POST",
      body: JSON.stringify({ uris: [`spotify:track:${spotifyTrackId}`] }),
    });
  }

  async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    await this.ensureWriteAuth();
    await this.request(`/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: "DELETE",
      body: JSON.stringify({ tracks: [{ uri: `spotify:track:${trackId}` }] }),
    });
  }

  async refreshAccessToken(): Promise<TokenPair> {
    const account = await this.getAccount();
    if (!account || account.isMock) throw new Error("Spotify account is not connected");

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: spotifyBasicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptToken(account.refreshTokenEncrypted),
      }),
    });

    if (!response.ok) {
      throw new Error(`Spotify token refresh failed: ${await response.text()}`);
    }

    const token = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);
    const refreshToken = token.refresh_token || decryptToken(account.refreshTokenEncrypted);

    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEncrypted: encryptToken(token.access_token),
        refreshTokenEncrypted: encryptToken(refreshToken),
        expiresAt,
      },
    });

    return {
      accessToken: token.access_token,
      refreshToken,
      expiresAt,
    };
  }

  isConnected(): boolean {
    return Boolean(this.userId);
  }
}
