import crypto from "crypto";
import type {
  NormalizedPlaylist,
  NormalizedTrack,
  ServiceUser,
} from "@/lib/sync/syncTypes";
import type {
  SpotifyPaged,
  SpotifyPlaylist,
  SpotifyPlaylistTrackItem,
  SpotifyTrack,
  SpotifyUser,
} from "./spotifyTypes";

const TOKEN_ENDPOINTS = [
  "https://open.spotify.com/get_access_token?reason=init&productType=web-player",
  "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
];
const HOME_PAGE = "https://open.spotify.com/";
const API_BASE = "https://api.spotify.com/v1";
const PAGE_LIMIT = 50;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

type WebTokenResponse = {
  clientId: string;
  accessToken: string;
  accessTokenExpirationTimestampMs: number;
  isAnonymous: boolean;
};

function userAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
}

function browserHeaders(spDcCookie: string, extra?: Record<string, string>) {
  return {
    Cookie: `sp_dc=${spDcCookie}`,
    "User-Agent": userAgent(),
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
    ...extra,
  };
}

export class SpotifyWebAuthError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "SpotifyWebAuthError";
  }
}

const TOTP_CIPHER = [12, 56, 76, 33, 88, 44, 88, 33, 78, 78, 11, 66, 22, 22, 55, 69, 54];
const TOTP_VERSION = "5";
const TOTP_PERIOD_MS = 30_000;

function totpSecretBytes(): Buffer {
  const processed = TOTP_CIPHER.map((b, i) => b ^ ((i % 33) + 9));
  const hexStr = processed.map((b) => b.toString()).join("");
  return Buffer.from(hexStr, "utf-8");
}

function generateTotp(timestampMs: number): string {
  const counter = Math.floor(timestampMs / TOTP_PERIOD_MS);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", totpSecretBytes()).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

function buildTotpUrl(baseUrl: string): string {
  const now = Date.now();
  const totp = generateTotp(now);
  const params = new URL(baseUrl);
  params.searchParams.set("totp", totp);
  params.searchParams.set("totpServer", totp);
  params.searchParams.set("totpVer", TOTP_VERSION);
  params.searchParams.set("ts", String(Math.floor(now / 1000)));
  return params.toString();
}

async function tryJsonEndpoint(spDcCookie: string): Promise<WebTokenResponse | null> {
  for (const baseUrl of TOKEN_ENDPOINTS) {
    for (const url of [buildTotpUrl(baseUrl), baseUrl]) {
      try {
        const response = await fetch(url, {
          headers: browserHeaders(spDcCookie, {
            Accept: "application/json",
            "App-Platform": "WebPlayer",
            "Spotify-App-Version": "1.2.55.500.gddccaf72",
            Origin: "https://open.spotify.com",
            Referer: "https://open.spotify.com/",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
          }),
          redirect: "follow",
        });
        if (!response.ok) continue;
        const data = (await response.json()) as WebTokenResponse;
        if (data.accessToken && !data.isAnonymous) return data;
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function tryHtmlScrape(spDcCookie: string): Promise<WebTokenResponse | null> {
  const response = await fetch(HOME_PAGE, {
    headers: browserHeaders(spDcCookie, {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    }),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new SpotifyWebAuthError(
      `Spotify homepage returned ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`,
      response.status,
    );
  }
  const html = await response.text();

  const sessionMatch = html.match(/<script[^>]*id=["']session["'][^>]*>([\s\S]*?)<\/script>/);
  if (sessionMatch?.[1]) {
    try {
      const data = JSON.parse(sessionMatch[1]) as WebTokenResponse;
      if (data.accessToken && !data.isAnonymous) return data;
    } catch {}
  }

  const tokenMatch = html.match(/"accessToken"\s*:\s*"([^"]+)"/);
  const expiresMatch = html.match(/"accessTokenExpirationTimestampMs"\s*:\s*(\d+)/);
  const anonymousMatch = html.match(/"isAnonymous"\s*:\s*(true|false)/);
  const clientIdMatch = html.match(/"clientId"\s*:\s*"([^"]+)"/);
  if (tokenMatch?.[1]) {
    return {
      accessToken: tokenMatch[1],
      accessTokenExpirationTimestampMs: expiresMatch ? Number(expiresMatch[1]) : Date.now() + 30 * 60_000,
      isAnonymous: anonymousMatch ? anonymousMatch[1] === "true" : false,
      clientId: clientIdMatch?.[1] || "",
    };
  }
  return null;
}

export async function getWebAccessToken(spDcCookie: string): Promise<string> {
  const cached = tokenCache.get(spDcCookie);
  if (cached && cached.expiresAt - Date.now() > 60_000) {
    return cached.token;
  }

  const data = (await tryJsonEndpoint(spDcCookie)) || (await tryHtmlScrape(spDcCookie));

  if (!data) {
    throw new SpotifyWebAuthError(
      "Could not extract access token from Spotify (cookie may be expired or Spotify blocked the request).",
      403,
    );
  }
  if (data.isAnonymous) {
    throw new SpotifyWebAuthError("sp_dc cookie is invalid or expired (anonymous token)", 401);
  }

  tokenCache.set(spDcCookie, {
    token: data.accessToken,
    expiresAt: data.accessTokenExpirationTimestampMs,
  });
  return data.accessToken;
}

async function webFetch<T>(spDcCookie: string, pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
  const token = await getWebAccessToken(spDcCookie);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": userAgent(),
      Accept: "application/json",
    },
  });
  if (response.status === 401) {
    tokenCache.delete(spDcCookie);
    throw new SpotifyWebAuthError("Web token rejected, sp_dc cookie may be expired", 401);
  }
  if (!response.ok) {
    throw new Error(`Spotify web API ${response.status}: ${await response.text().catch(() => "")}`);
  }
  return (await response.json()) as T;
}

async function fetchAllPages<T>(spDcCookie: string, firstPath: string): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | null = firstPath;
  while (nextUrl) {
    const page: SpotifyPaged<T> = await webFetch<SpotifyPaged<T>>(spDcCookie, nextUrl);
    if (Array.isArray(page.items)) items.push(...page.items);
    nextUrl = page.next || null;
  }
  return items;
}

function normalizeTrack(track: SpotifyTrack): NormalizedTrack {
  return {
    title: track.name,
    artists: track.artists?.map((artist) => artist.name) || [],
    album: track.album?.name,
    durationMs: track.duration_ms,
    isrc: track.external_ids?.isrc,
    sourceService: "spotify",
    sourceTrackId: track.id,
    url: track.external_urls?.spotify,
  };
}

export async function webGetMe(spDcCookie: string): Promise<ServiceUser> {
  const user = await webFetch<SpotifyUser>(spDcCookie, "/me");
  return {
    id: user.id,
    username: user.display_name || user.email || user.id,
  };
}

export async function webGetMyPlaylists(spDcCookie: string): Promise<NormalizedPlaylist[]> {
  const me = await webFetch<SpotifyUser>(spDcCookie, "/me");
  const playlists = await fetchAllPages<SpotifyPlaylist>(spDcCookie, `/me/playlists?limit=${PAGE_LIMIT}`);
  return playlists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    description: playlist.description || undefined,
    imageUrl: playlist.images?.[0]?.url,
    trackCount: playlist.tracks.total,
    isWritable: Boolean(playlist.owner?.id === me.id || playlist.collaborative),
  }));
}

export async function webGetPlaylistTracks(spDcCookie: string, playlistId: string): Promise<NormalizedTrack[]> {
  const fields = "items(track(id,uri,name,duration_ms,external_ids,external_urls,album(name),artists(name))),next";
  const items = await fetchAllPages<SpotifyPlaylistTrackItem>(
    spDcCookie,
    `/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${PAGE_LIMIT}&fields=${encodeURIComponent(fields)}`,
  );
  return items
    .map((item) => item.track)
    .filter((track): track is SpotifyTrack => Boolean(track?.id))
    .map(normalizeTrack);
}

export async function webSearchTrack(spDcCookie: string, query: string): Promise<NormalizedTrack[]> {
  const data = await webFetch<{ tracks: SpotifyPaged<SpotifyTrack> }>(
    spDcCookie,
    `/search?type=track&limit=10&q=${encodeURIComponent(query)}`,
  );
  return data.tracks.items.map(normalizeTrack);
}
