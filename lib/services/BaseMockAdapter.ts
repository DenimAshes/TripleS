import type { MusicServiceAdapter } from "./MusicServiceAdapter";
import { playlists, tracksFor } from "./mockData";
import type { ServiceKey, TrackSearchQuery } from "@/lib/sync/syncTypes";

export class BaseMockAdapter implements MusicServiceAdapter {
  constructor(private service: ServiceKey) {}

  async getCurrentUser() {
    return { id: `mock_${this.service}_user`, username: `${this.service} mock account` };
  }

  async getPlaylists() {
    return playlists[this.service];
  }

  async createPlaylist(name: string) {
    return {
      id: `mock_${this.service}_${Date.now()}`,
      name,
      trackCount: 0,
      isWritable: true,
    };
  }

  async getPlaylistTracks(playlistId: string) {
    return tracksFor(this.service, playlistId);
  }

  async searchTrack(query: TrackSearchQuery) {
    const candidates = tracksFor(this.service, "search");
    if (query.isrc) {
      const byIsrc = candidates.filter((track) => track.isrc === query.isrc);
      if (byIsrc.length) return byIsrc;
    }
    const q = query.query.toLowerCase();
    return candidates.filter((track) => `${track.title} ${track.artists.join(" ")}`.toLowerCase().includes(q.split(" ")[0]));
  }

  async addTrackToPlaylist() {}

  async removeTrackFromPlaylist() {}

  async refreshAccessToken() {
    return {
      accessToken: `mock_${this.service}_access`,
      refreshToken: `mock_${this.service}_refresh`,
      expiresAt: new Date(Date.now() + 3600_000),
    };
  }

  isConnected() {
    return true;
  }
}
