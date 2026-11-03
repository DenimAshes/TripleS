import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SPOTIFY_REDIRECT_URI, getSpotifyRedirectUri, validateSpotifyRedirectUri } from "../lib/services/spotify/spotifyAuth";

describe("spotify auth config", () => {
  const originalRedirectUri = process.env.SPOTIFY_REDIRECT_URI;
  const originalAppUrl = process.env.APP_URL;

  afterEach(() => {
    if (originalRedirectUri === undefined) delete process.env.SPOTIFY_REDIRECT_URI;
    else process.env.SPOTIFY_REDIRECT_URI = originalRedirectUri;
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
  });

  it("uses 127.0.0.1 redirect URI by default for local OAuth", () => {
    delete process.env.SPOTIFY_REDIRECT_URI;
    delete process.env.APP_URL;
    expect(getSpotifyRedirectUri()).toBe(DEFAULT_SPOTIFY_REDIRECT_URI);
  });

  it("derives the callback from APP_URL when no explicit redirect is set", () => {
    delete process.env.SPOTIFY_REDIRECT_URI;
    process.env.APP_URL = "https://app.example.com/base";
    expect(getSpotifyRedirectUri()).toBe("https://app.example.com/api/oauth/spotify/callback");
  });

  it("rejects localhost redirect URI before sending user to Spotify", () => {
    process.env.SPOTIFY_REDIRECT_URI = "http://localhost:3000/api/oauth/spotify/callback";
    expect(validateSpotifyRedirectUri()).toEqual({
      ok: false,
      error: "Spotify rejects localhost redirect URIs. Use http://127.0.0.1:3000/api/oauth/spotify/callback instead.",
    });
  });

  it("rejects malformed redirect configuration", () => {
    process.env.SPOTIFY_REDIRECT_URI = "not a URL";
    expect(validateSpotifyRedirectUri()).toEqual({
      ok: false,
      error: "SPOTIFY_REDIRECT_URI or APP_URL is not a valid absolute URL.",
    });
  });
});
