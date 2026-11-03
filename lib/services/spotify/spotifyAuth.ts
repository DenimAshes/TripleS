import crypto from "crypto";

export const DEFAULT_SPOTIFY_REDIRECT_URI = "http://127.0.0.1:3000/api/oauth/spotify/callback";

export const SPOTIFY_READ_SCOPES = [
  "user-read-private",
  "user-read-email",
];

export const SPOTIFY_PLAYLIST_READ_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
];

export const SPOTIFY_WRITE_SCOPES = [
  "playlist-modify-private",
  "playlist-modify-public",
];

export function getSpotifyScopes() {
  if (process.env.SPOTIFY_SCOPES) {
    return process.env.SPOTIFY_SCOPES;
  }
  const scopes = [...SPOTIFY_READ_SCOPES];
  if (process.env.SPOTIFY_ENABLE_PLAYLIST_SCOPES !== "false") {
    scopes.push(...SPOTIFY_PLAYLIST_READ_SCOPES);
  }
  if (process.env.SPOTIFY_ENABLE_WRITE_SCOPES === "true") {
    scopes.push(...SPOTIFY_WRITE_SCOPES);
  }
  return scopes.join(" ");
}

export function getMissingSpotifyScopes(grantedScopes: readonly string[], requiredScopes = getSpotifyScopes()) {
  const granted = new Set(grantedScopes);
  return requiredScopes.split(/\s+/).filter(Boolean).filter((scope) => !granted.has(scope));
}

export function hasSpotifyCredentials() {
  return Boolean(process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim());
}

export function getSpotifyRedirectUri() {
  if (process.env.SPOTIFY_REDIRECT_URI) return process.env.SPOTIFY_REDIRECT_URI;
  if (process.env.APP_URL) {
    try {
      return new URL("/api/oauth/spotify/callback", process.env.APP_URL).toString();
    } catch {
      return process.env.APP_URL;
    }
  }
  return DEFAULT_SPOTIFY_REDIRECT_URI;
}

export function validateSpotifyRedirectUri() {
  let redirectUri: URL;
  try {
    redirectUri = new URL(getSpotifyRedirectUri());
  } catch {
    return { ok: false, error: "SPOTIFY_REDIRECT_URI or APP_URL is not a valid absolute URL." };
  }
  if (redirectUri.protocol !== "http:" && redirectUri.protocol !== "https:") {
    return { ok: false, error: "Spotify redirect URI must use http or https." };
  }
  if (redirectUri.hostname.toLowerCase() === "localhost") {
    return {
      ok: false,
      error: "Spotify rejects localhost redirect URIs. Use http://127.0.0.1:3000/api/oauth/spotify/callback instead.",
    };
  }
  return { ok: true, error: null };
}

export function createSpotifyState() {
  return crypto.randomBytes(16).toString("hex");
}

export function spotifyBasicAuthHeader() {
  const credentials = `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

export function buildSpotifyAuthorizeUrl(state: string) {
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", process.env.SPOTIFY_CLIENT_ID || "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", getSpotifyRedirectUri());
  url.searchParams.set("scope", getSpotifyScopes());
  url.searchParams.set("state", state);
  url.searchParams.set("show_dialog", "true");
  return url.toString();
}
