import "./_runnerGuard";
import fs from "node:fs";
import { type BrowserContext, type Page } from "playwright";
import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import { openWorkerBrowser, saveStorageState } from "../browserSession";
import { debugArtifactPath, SERVICE_URLS } from "../config";
import { sleep } from "../sleep";
import { acquireSession, evictSession, sessionReuseEnabled } from "../sessionPool";
import { pathToFileURL } from "node:url";

export type SoundCloudPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  imageUrl?: string;
  url: string;
  isWritable?: boolean;
  apiId?: string;
  permalink?: string;
};

const SERVICE = "soundcloud";
const API_BASE = "https://api-v2.soundcloud.com";
const API_TIMEOUT_MS = Math.max(1, Number(process.env.SOUNDCLOUD_API_TIMEOUT_MS ?? 45_000));
const RUNNER_TIMEOUT_MS = Math.max(1, Number(process.env.SOUNDCLOUD_RUNNER_TIMEOUT_MS ?? 600_000));

type SoundCloudRuntime = {
  clientId: string;
  userId: number;
};

type SoundCloudApiUser = {
  username?: string;
};

type SoundCloudApiTrack = {
  id?: number | string;
  title?: string;
  duration?: number;
  permalink_url?: string;
  artwork_url?: string;
  user?: SoundCloudApiUser;
};

type SoundCloudApiPlaylist = {
  id?: number | string;
  title?: string;
  track_count?: number;
  tracks?: SoundCloudApiTrack[];
  permalink_url?: string;
  artwork_url?: string;
  user_id?: number;
};

type SoundCloudApiCollection<T> = {
  collection?: T[];
  next_href?: string | null;
};

async function withContext<T>(
  fn: (ctx: BrowserContext, page: Page) => Promise<T>,
  opts?: { humanize?: boolean },
): Promise<T> {
  let abortCleanup: (() => Promise<void>) | null = null;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(async () => {
      timedOut = true;
      if (abortCleanup) await abortCleanup().catch(() => {});
      reject(new Error(`SoundCloud runner timed out after ${RUNNER_TIMEOUT_MS}ms`));
    }, RUNNER_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
  });

  const run = async () => {
    if (sessionReuseEnabled()) {
      const session = await acquireSession(SERVICE);
      abortCleanup = () => evictSession(SERVICE);
      try {
        const result = await fn(session.context, session.page);
        if (process.env.SAVE_STATE_AFTER_RUN === "true") {
          await saveStorageState(SERVICE, session.context);
        }
        return result;
      } catch (error) {
        if (timedOut) throw new Error(`SoundCloud runner timed out after ${RUNNER_TIMEOUT_MS}ms`);
        throw error;
      }
    }
    const session = await openWorkerBrowser({ service: SERVICE, humanize: opts?.humanize });
    abortCleanup = () => session.close();
    try {
      const result = await fn(session.context, session.page);
      if (process.env.SAVE_STATE_AFTER_RUN === "true") {
        await saveStorageState(SERVICE, session.context);
      }
      return result;
    } catch (error) {
      if (timedOut) throw new Error(`SoundCloud runner timed out after ${RUNNER_TIMEOUT_MS}ms`);
      throw error;
    } finally {
      if (!timedOut) await session.close();
    }
  };

  return Promise.race([run(), timeoutPromise]);
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await sleep(1500);
}

async function maybeDebug(page: Page, label: string): Promise<void> {
  if (process.env.SC_DEBUG !== "true") return;
  await page.screenshot({ path: debugArtifactPath(`${label}.png`), fullPage: true });
  fs.writeFileSync(debugArtifactPath(`${label}.html`), await page.content());
}

async function getRuntime(page: Page): Promise<SoundCloudRuntime> {
  if (!page.url().includes("soundcloud.com")) {
    await page.goto(SERVICE_URLS.soundcloud.home, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } else {
    await page.goto(SERVICE_URLS.soundcloud.home, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  }
  await settle(page);

  const runtime = await page.evaluate(() => {
    const hydration = (window as Window & { __sc_hydration?: Array<{ hydratable?: string; data?: unknown }> }).__sc_hydration || [];
    const apiClient = hydration.find((item) => item?.hydratable === "apiClient")?.data as { id?: string } | undefined;
    const meUser = hydration.find((item) => item?.hydratable === "meUser")?.data as { id?: number } | undefined;
    return {
      clientId: apiClient?.id || "",
      userId: meUser?.id || 0,
    };
  });

  if (!runtime.clientId || !runtime.userId) {
    await maybeDebug(page, "soundcloud-runtime");
    throw new Error("SoundCloud session is not signed in. Run: npm run chrome -- soundcloud && npm run login -- soundcloud cdp");
  }

  return runtime;
}

function withClientId(url: string, clientId: string): string {
  const parsed = new URL(url.startsWith("http") ? url : `${API_BASE}${url}`);
  if (!parsed.searchParams.has("client_id")) {
    parsed.searchParams.set("client_id", clientId);
  }
  return parsed.toString();
}

async function apiGet<T>(page: Page, runtime: SoundCloudRuntime, url: string): Promise<T> {
  const requestUrl = withClientId(url, runtime.clientId);
  return page.evaluate(async ({ requestUrl, timeoutMs }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(requestUrl, { credentials: "include", signal: controller.signal }).finally(() => clearTimeout(timer));
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`SoundCloud API ${response.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text);
  }, { requestUrl, timeoutMs: API_TIMEOUT_MS });
}

async function apiPut<T>(page: Page, runtime: SoundCloudRuntime, url: string, body: unknown): Promise<T> {
  const requestUrl = withClientId(url, runtime.clientId);
  return page.evaluate(async ({ requestUrl, body, timeoutMs }) => {
    const cookies = Object.fromEntries(
      document.cookie.split(";").map((item) => {
        const [key, ...value] = item.trim().split("=");
        return [decodeURIComponent(key), decodeURIComponent(value.join("="))];
      }),
    );
    const oauthToken = cookies.oauth_token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(requestUrl, {
      method: "PUT",
      credentials: "include",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(oauthToken ? { Authorization: `OAuth ${oauthToken}` } : {}),
      },
      body: JSON.stringify(body),
    }).finally(() => clearTimeout(timer));
    const text = await response.text();
    if (!response.ok) {
      if (response.status === 403 && /captcha-delivery|captcha/i.test(text)) {
        throw new Error("SoundCloud blocked the write request with captcha. Reading still works; open SoundCloud in the saved Chrome profile and try again later.");
      }
      throw new Error(`SoundCloud API ${response.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : {};
  }, { requestUrl, body, timeoutMs: API_TIMEOUT_MS });
}

async function apiPost<T>(page: Page, runtime: SoundCloudRuntime, url: string, body: unknown): Promise<T> {
  const requestUrl = withClientId(url, runtime.clientId);
  return page.evaluate(async ({ requestUrl, body, timeoutMs }) => {
    const cookies = Object.fromEntries(
      document.cookie.split(";").map((item) => {
        const [key, ...value] = item.trim().split("=");
        return [decodeURIComponent(key), decodeURIComponent(value.join("="))];
      }),
    );
    const oauthToken = cookies.oauth_token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(requestUrl, {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(oauthToken ? { Authorization: `OAuth ${oauthToken}` } : {}),
      },
      body: JSON.stringify(body),
    }).finally(() => clearTimeout(timer));
    const text = await response.text();
    if (!response.ok) {
      if (response.status === 403 && /captcha-delivery|captcha/i.test(text)) {
        throw new Error("SoundCloud blocked the write request with captcha. Reading still works; open SoundCloud in the saved Chrome profile and try again later.");
      }
      throw new Error(`SoundCloud API ${response.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : {};
  }, { requestUrl, body, timeoutMs: API_TIMEOUT_MS });
}

async function apiGetCollection<T>(page: Page, runtime: SoundCloudRuntime, url: string, maxPages = 8): Promise<T[]> {
  const out: T[] = [];
  let nextUrl: string | null = url;

  for (let pageIndex = 0; nextUrl && pageIndex < maxPages; pageIndex += 1) {
    const data: SoundCloudApiCollection<T> = await apiGet<SoundCloudApiCollection<T>>(page, runtime, nextUrl);
    out.push(...(data.collection || []));
    nextUrl = data.next_href || null;
  }

  return out;
}

async function scrollMainContent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scrollable = document.scrollingElement || document.documentElement;
    const before = scrollable.scrollTop;
    scrollable.scrollBy({ top: Math.max(700, Math.floor(window.innerHeight * 0.9)), behavior: "auto" });
    return scrollable.scrollTop > before;
  });
}

async function collectWhileScrolling<T>(page: Page, extract: () => Promise<T[]>, maxScrolls = 30): Promise<T[]> {
  const byKey = new Map<string, T>();
  for (let i = 0; i < maxScrolls; i += 1) {
    for (const item of await extract()) {
      const key = JSON.stringify(item);
      byKey.set(key, item);
    }
    const moved = await scrollMainContent(page);
    await sleep(600);
    if (!moved) break;
  }
  return Array.from(byKey.values());
}

function normalizeSoundCloudPath(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname.replace(/^\/+|\/+$/g, "");
}

function soundCloudPathFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return undefined;
  }
}

function parseDurationMs(value: string): number | undefined {
  const match = value.match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

async function extractVisiblePlaylists(page: Page): Promise<SoundCloudPlaylist[]> {
  return page.evaluate(() => {
    const out: SoundCloudPlaylist[] = [];
    const seen = new Set<string>();

    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/sets/"]'))) {
      const url = new URL(a.href, location.href);
      if (url.hostname !== "soundcloud.com" || !url.pathname.includes("/sets/")) continue;
      const id = url.pathname.replace(/^\/+|\/+$/g, "");
      if (!id || seen.has(id)) continue;

      const card = a.closest("li, article, .soundList__item, .systemPlaylistTile, .audibleTile") || a.parentElement || a;
      const name = (a.getAttribute("title") || a.getAttribute("aria-label") || a.textContent || "").replace(/\s+/g, " ").trim();
      if (!name) continue;

      const cardText = (card.textContent || "").replace(/\s+/g, " ");
      const trackMatch = cardText.match(/(\d+)\s*(tracks?|songs?)/i);
      const imageUrl = (card.querySelector("img") as HTMLImageElement | null)?.src;

      seen.add(id);
      out.push({
        id,
        name,
        trackCount: trackMatch ? Number(trackMatch[1]) : 0,
        imageUrl: imageUrl || undefined,
        url: url.href,
      });
    }

    return out;
  });
}

async function extractVisibleTracks(page: Page): Promise<NormalizedTrack[]> {
  const raw = await page.evaluate(() => {
    const out: Array<{ title: string; artist: string; url: string; id: string; duration?: string; imageUrl?: string }> = [];
    const seen = new Set<string>();

    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/"], a[href^="https://soundcloud.com/"]'))) {
      const url = new URL(a.href, location.href);
      if (url.hostname !== "soundcloud.com") continue;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length !== 2) continue;
      if (["you", "discover", "search", "stream", "charts", "upload", "pages", "terms"].includes(parts[0])) continue;
      if (parts[1] === "sets") continue;

      const id = url.pathname.replace(/^\/+|\/+$/g, "");
      if (!id || seen.has(id)) continue;

      const row = a.closest("li, article, .soundList__item, .searchItem, .sound, .trackItem") || a.parentElement || a;
      const title = (a.getAttribute("title") || a.getAttribute("aria-label") || a.textContent || "").replace(/\s+/g, " ").trim();
      if (!title || title === parts[0]) continue;

      const artistLink = row.querySelector<HTMLAnchorElement>(`a[href="/${parts[0]}"], a[href="https://soundcloud.com/${parts[0]}"]`);
      const artist = (artistLink?.textContent || parts[0]).replace(/\s+/g, " ").trim();
      const durationText = (row.textContent || "").replace(/\s+/g, " ");
      const duration = durationText.match(/(?:(\d+):)?\d{1,2}:\d{2}/)?.[0];
      const imageUrl = (row.querySelector("img") as HTMLImageElement | null)?.src;

      seen.add(id);
      out.push({ title, artist, url: url.href, id, duration, imageUrl: imageUrl || undefined });
    }

    return out;
  });

  return raw.map((track) => ({
    title: track.title,
    artists: [track.artist || "Unknown artist"],
    durationMs: track.duration ? parseDurationMs(track.duration) : undefined,
    sourceService: "soundcloud",
    sourceTrackId: track.id,
    url: track.url,
    imageUrl: track.imageUrl,
  }));
}

function normalizePlaylist(
  item: SoundCloudApiPlaylist | { playlist?: SoundCloudApiPlaylist },
  runtime?: SoundCloudRuntime,
): SoundCloudPlaylist | undefined {
  const playlist = "playlist" in item && item.playlist ? item.playlist : (item as SoundCloudApiPlaylist);
  const id = soundCloudPathFromUrl(playlist.permalink_url) || (playlist.id == null ? undefined : String(playlist.id));
  const name = playlist.title?.trim();
  const url = playlist.permalink_url || (id ? `https://soundcloud.com/${id}` : undefined);
  if (!id || !name || !url) return undefined;

  const apiId = playlist.id == null ? undefined : String(playlist.id);
  const permalink = soundCloudPathFromUrl(playlist.permalink_url) || undefined;
  return {
    id,
    name,
    trackCount: playlist.track_count ?? playlist.tracks?.length ?? 0,
    imageUrl: playlist.artwork_url || undefined,
    url,
    isWritable: runtime ? playlist.user_id === runtime.userId : undefined,
    apiId,
    permalink,
  };
}

function normalizeTrack(track: SoundCloudApiTrack): NormalizedTrack | undefined {
  const title = track.title?.trim();
  const id = soundCloudPathFromUrl(track.permalink_url) || (track.id == null ? undefined : String(track.id));
  if (!title || !id) return undefined;

  return {
    title,
    artists: [track.user?.username?.trim() || "Unknown artist"],
    durationMs: track.duration,
    sourceService: "soundcloud",
    sourceTrackId: id,
    url: track.permalink_url,
    imageUrl: track.artwork_url || undefined,
  };
}

async function listPlaylistsViaApi(page: Page, runtime: SoundCloudRuntime): Promise<SoundCloudPlaylist[]> {
  const owned = await apiGetCollection<SoundCloudApiPlaylist>(
    page,
    runtime,
    `/users/${runtime.userId}/playlists_without_albums?limit=50&linked_partitioning=1`,
  ).catch(() => []);
  const liked = await apiGetCollection<{ playlist?: SoundCloudApiPlaylist } | SoundCloudApiPlaylist>(
    page,
    runtime,
    `/users/${runtime.userId}/playlist_likes?limit=50&linked_partitioning=1`,
  ).catch(() => []);

  const byId = new Map<string, SoundCloudPlaylist>();
  for (const playlist of [...owned, ...liked]) {
    const normalized = normalizePlaylist(playlist, runtime);
    if (normalized) byId.set(normalized.id, normalized);
  }
  return Array.from(byId.values());
}

async function resolvePlaylistViaApi(page: Page, runtime: SoundCloudRuntime, playlistIdOrUrl: string): Promise<SoundCloudApiPlaylist | undefined> {
  const url = playlistIdOrUrl.startsWith("http") ? playlistIdOrUrl : `https://soundcloud.com/${playlistIdOrUrl}`;
  return apiGet<SoundCloudApiPlaylist>(page, runtime, `/resolve?url=${encodeURIComponent(url)}`).catch(() => undefined);
}

async function resolveTrackViaApi(page: Page, runtime: SoundCloudRuntime, trackIdOrUrl: string): Promise<SoundCloudApiTrack | undefined> {
  if (/^\d+$/.test(trackIdOrUrl)) {
    return apiGet<SoundCloudApiTrack>(page, runtime, `/tracks/${trackIdOrUrl}`).catch(() => undefined);
  }
  const url = trackIdOrUrl.startsWith("http") ? trackIdOrUrl : `https://soundcloud.com/${trackIdOrUrl}`;
  return apiGet<SoundCloudApiTrack>(page, runtime, `/resolve?url=${encodeURIComponent(url)}`).catch(() => undefined);
}

function playlistTrackIds(playlist: SoundCloudApiPlaylist): number[] {
  const ids: number[] = [];
  for (const track of playlist.tracks || []) {
    const id = Number(track.id);
    if (Number.isFinite(id)) ids.push(id);
  }
  return ids;
}

async function updatePlaylistTrackIds(
  page: Page,
  runtime: SoundCloudRuntime,
  playlist: SoundCloudApiPlaylist,
  trackIds: number[],
): Promise<void> {
  if (!playlist.id) throw new Error("SoundCloud playlist id is missing.");
  if (playlist.user_id !== runtime.userId) {
    throw new Error("This SoundCloud playlist is not writable.");
  }

  await apiPut(page, runtime, `/playlists/${playlist.id}`, {
    playlist: {
      tracks: trackIds,
    },
  });
}

export async function addSoundCloudTrackToPlaylist(playlistIdOrUrl: string, trackIdOrUrl: string): Promise<{ added: boolean }> {
  return withContext(async (_ctx, page) => {
    const runtime = await getRuntime(page);
    const playlist = await resolvePlaylistViaApi(page, runtime, playlistIdOrUrl);
    const track = await resolveTrackViaApi(page, runtime, trackIdOrUrl);
    if (!playlist) throw new Error("SoundCloud playlist not found.");
    if (!track?.id) throw new Error("SoundCloud track not found.");

    const trackId = Number(track.id);
    const ids = playlistTrackIds(playlist);
    if (ids.includes(trackId)) return { added: false };

    await updatePlaylistTrackIds(page, runtime, playlist, [...ids, trackId]);
    return { added: true };
  });
}

export async function createSoundCloudPlaylist(name: string): Promise<SoundCloudPlaylist> {
  return withContext(async (_ctx, page) => {
    const runtime = await getRuntime(page);
    const playlist = await apiPost<SoundCloudApiPlaylist>(page, runtime, "/playlists", {
      playlist: {
        title: name,
        sharing: "private",
        tracks: [],
      },
    });
    const normalized = normalizePlaylist(playlist, runtime);
    if (!normalized) throw new Error("SoundCloud playlist was created but could not be read.");
    return normalized;
  });
}

export async function removeSoundCloudTrackFromPlaylist(playlistIdOrUrl: string, trackIdOrUrl: string): Promise<{ removed: boolean }> {
  return withContext(async (_ctx, page) => {
    const runtime = await getRuntime(page);
    const playlist = await resolvePlaylistViaApi(page, runtime, playlistIdOrUrl);
    const track = await resolveTrackViaApi(page, runtime, trackIdOrUrl);
    if (!playlist) throw new Error("SoundCloud playlist not found.");
    if (!track?.id) throw new Error("SoundCloud track not found.");

    const trackId = Number(track.id);
    const ids = playlistTrackIds(playlist);
    if (!ids.includes(trackId)) return { removed: false };

    await updatePlaylistTrackIds(page, runtime, playlist, ids.filter((id) => id !== trackId));
    return { removed: true };
  });
}

async function listTracksViaApi(page: Page, runtime: SoundCloudRuntime, playlistIdOrUrl: string): Promise<NormalizedTrack[]> {
  const playlist = await resolvePlaylistViaApi(page, runtime, playlistIdOrUrl);
  const tracks = playlist?.tracks || [];
  const missingIds = tracks
    .filter((track) => !track.title && track.id != null)
    .map((track) => String(track.id));

  const hydratedById = new Map<string, SoundCloudApiTrack>();
  for (let i = 0; i < missingIds.length; i += 50) {
    const batchIds = missingIds.slice(i, i + 50);
    const batch = await apiGet<SoundCloudApiTrack[]>(page, runtime, `/tracks?ids=${batchIds.join(",")}`).catch(() => []);
    for (const track of batch) {
      if (track.id != null) hydratedById.set(String(track.id), track);
    }
  }

  const byId = new Map<string, NormalizedTrack>();
  for (const track of tracks) {
    const fullTrack = track.title || track.id == null ? track : hydratedById.get(String(track.id)) || track;
    const normalized = normalizeTrack(fullTrack);
    if (normalized) byId.set(normalized.sourceTrackId, normalized);
  }
  return Array.from(byId.values());
}

async function searchTracksViaApi(page: Page, runtime: SoundCloudRuntime, query: string): Promise<NormalizedTrack[]> {
  const items = await apiGetCollection<SoundCloudApiTrack>(
    page,
    runtime,
    `/search/tracks?q=${encodeURIComponent(query)}&limit=20&linked_partitioning=1`,
    2,
  ).catch(() => []);
  const byId = new Map<string, NormalizedTrack>();
  for (const track of items) {
    const normalized = normalizeTrack(track);
    if (normalized) byId.set(normalized.sourceTrackId, normalized);
  }
  return Array.from(byId.values());
}

export async function listSoundCloudPlaylists(): Promise<SoundCloudPlaylist[]> {
  return withContext(async (_ctx, page) => {
    const runtime = await getRuntime(page);
    const apiItems = await listPlaylistsViaApi(page, runtime);
    if (apiItems.length) return apiItems;

    await page.goto(SERVICE_URLS.soundcloud.playlists!, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(page);
    await maybeDebug(page, "soundcloud-playlists");
    const items = await collectWhileScrolling(page, () => extractVisiblePlaylists(page), 25);
    const byId = new Map(items.map((item) => [item.id, item]));
    return Array.from(byId.values());
  }, { humanize: false });
}

export async function listSoundCloudPlaylistTracks(playlistIdOrUrl: string): Promise<NormalizedTrack[]> {
  return withContext(async (_ctx, page) => {
    const runtime = await getRuntime(page);
    const apiItems = await listTracksViaApi(page, runtime, playlistIdOrUrl);
    if (apiItems.length) return apiItems;

    const url = playlistIdOrUrl.startsWith("http") ? playlistIdOrUrl : `https://soundcloud.com/${playlistIdOrUrl}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(page);
    await maybeDebug(page, "soundcloud-playlist-tracks");
    const items = await collectWhileScrolling(page, () => extractVisibleTracks(page), 50);
    const byId = new Map(items.map((item) => [item.sourceTrackId, item]));
    return Array.from(byId.values());
  }, { humanize: false });
}

export async function searchSoundCloudTracks(query: string): Promise<NormalizedTrack[]> {
  return withContext(async (_ctx, page) => {
    const runtime = await getRuntime(page);
    const apiItems = await searchTracksViaApi(page, runtime, query);
    if (apiItems.length) return apiItems;

    await page.goto(`https://soundcloud.com/search/sounds?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(page);
    await maybeDebug(page, "soundcloud-search");
    const items = await collectWhileScrolling(page, () => extractVisibleTracks(page), 10);
    const byId = new Map(items.map((item) => [item.sourceTrackId, item]));
    return Array.from(byId.values());
  }, { humanize: false });
}

async function main() {
  const command = process.argv[2] || "list";

  if (command === "list") {
    const items = await listSoundCloudPlaylists();
    console.log(JSON.stringify(items, null, 2));
    console.log(`\nFound ${items.length} SoundCloud playlists.`);
    return;
  }

  if (command === "tracks") {
    const playlist = process.argv[3];
    if (!playlist) throw new Error('Usage: npm run sc -- tracks "<playlist id or url>"');
    const items = await listSoundCloudPlaylistTracks(normalizeSoundCloudPath(playlist.startsWith("http") ? playlist : `https://soundcloud.com/${playlist}`));
    console.log(JSON.stringify(items, null, 2));
    console.log(`\nFound ${items.length} tracks.`);
    return;
  }

  if (command === "search") {
    const query = process.argv.slice(3).join(" ");
    if (!query) throw new Error('Usage: npm run sc -- search "<artist - title>"');
    const items = await searchSoundCloudTracks(query);
    console.log(JSON.stringify(items, null, 2));
    console.log(`\nFound ${items.length} tracks.`);
    return;
  }

  if (command === "add") {
    const playlist = process.argv[3];
    const track = process.argv[4];
    if (!playlist || !track) throw new Error('Usage: npm run sc -- add "<playlist id or url>" "<track id or url>"');
    const result = await addSoundCloudTrackToPlaylist(playlist, track);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "create") {
    const name = process.argv.slice(3).join(" ");
    if (!name) throw new Error('Usage: npm run sc -- create "<playlist name>"');
    const result = await createSoundCloudPlaylist(name);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "create-b64") {
    const encoded = process.argv[3];
    if (!encoded) throw new Error('Usage: npm run sc -- create-b64 "<base64 playlist name>"');
    const result = await createSoundCloudPlaylist(Buffer.from(encoded, "base64").toString("utf8"));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "remove") {
    const playlist = process.argv[3];
    const track = process.argv[4];
    if (!playlist || !track) throw new Error('Usage: npm run sc -- remove "<playlist id or url>" "<track id or url>"');
    const result = await removeSoundCloudTrackFromPlaylist(playlist, track);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error("Usage: npm run sc -- list | tracks | search | add | create | create-b64 | remove");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const watchdog = setTimeout(() => {
    console.error(new Error(`SoundCloud runner hard timeout after ${RUNNER_TIMEOUT_MS}ms`));
    process.exit(1);
  }, RUNNER_TIMEOUT_MS + 5_000);
  main()
    .then(() => {
      clearTimeout(watchdog);
      setImmediate(() => process.exit(0));
    })
    .catch((err) => {
      clearTimeout(watchdog);
      console.error(err);
      process.exit(1);
    });
}
