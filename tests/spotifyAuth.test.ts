import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SPOTIFY_REDIRECT_URI, getSpotifyRedirectUri, validateSpotifyRedirectUri } from "../lib/services/spotify/spotifyAuth";

describe("spotify auth config", () => {
  const originalRedirectUri = process.env.SPOTIFY_REDIRECT_URI;

  afterEach(() => {
    process.env.SPOTIFY_REDIRECT_URI = originalRedirectUri;
  });

  it("uses 127.0.0.1 redirect URI by default for local OAuth", () => {
    delete process.env.SPOTIFY_REDIRECT_URI;
    expect(getSpotifyRedirectUri()).toBe(DEFAULT_SPOTIFY_REDIRECT_URI);
  });

  it("rejects localhost redirect URI before sending user to Spotify", () => {
    process.env.SPOTIFY_REDIRECT_URI = "http://localhost:3000/api/oauth/spotify/callback";
    expect(validateSpotifyRedirectUri()).toEqual({
      ok: false,
      error: "Spotify rejects localhost redirect URIs. Use http://127.0.0.1:3000/api/oauth/spotify/callback instead.",
    });
  });
});
