import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  decryptToken: vi.fn(() => "access-token"),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connectedAccount: {
      findUnique: mocks.findUnique,
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/crypto/tokenEncryption", () => ({
  decryptToken: mocks.decryptToken,
  encryptToken: vi.fn((value: string) => value),
}));

vi.mock("@/lib/services/spotify/spotifyCookieStore", () => ({
  getSpotifyWebCookie: vi.fn(async () => null),
}));

import { SpotifyAdapter } from "../lib/services/spotify/SpotifyAdapter";

describe("SpotifyAdapter playlist writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: "account-1",
      userId: "user-1",
      service: "SPOTIFY",
      accessTokenEncrypted: "encrypted-access",
      refreshTokenEncrypted: "encrypted-refresh",
      expiresAt: new Date(Date.now() + 3600_000),
      serviceUserId: "spotify-user",
      isMock: false,
    });
  });

  it("uses Spotify's current playlist creation endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "playlist-1",
      name: "Write check",
      description: "TripleS",
      images: [],
      items: { total: 0 },
    }), { status: 201, headers: { "Content-Type": "application/json" } })));

    await new SpotifyAdapter("user-1").createPlaylist("Write check", "TripleS");

    expect(fetch).toHaveBeenCalledWith("https://api.spotify.com/v1/me/playlists", expect.objectContaining({ method: "POST" }));
  });

  it("adds and removes playlist items through the non-deprecated endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ snapshot_id: "snapshot-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    const adapter = new SpotifyAdapter("user-1");

    await adapter.addTrackToPlaylist("playlist-1", {
      title: "Write check",
      artists: ["TripleS"],
      sourceService: "spotify",
      sourceTrackId: "track-1",
    });
    await adapter.removeTrackFromPlaylist("playlist-1", "track-1");

    expect(fetch).toHaveBeenNthCalledWith(1, "https://api.spotify.com/v1/playlists/playlist-1/items", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ uris: ["spotify:track:track-1"] }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, "https://api.spotify.com/v1/playlists/playlist-1/items", expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ items: [{ uri: "spotify:track:track-1" }] }),
    }));
  });
});
