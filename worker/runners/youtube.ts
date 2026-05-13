import fs from "node:fs";
import { type BrowserContext, type Locator, type Page } from "playwright";
import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import { normalizeArtist, normalizeTitle } from "@/lib/utils/normalizeTrack";
import { openWorkerBrowser, saveStorageState } from "../browserSession";
import { debugArtifactPath, SERVICE_URLS } from "../config";
import { humanDwell, humanHoverClick, sleep } from "../sleep";
import { acquireSession, sessionReuseEnabled } from "../sessionPool";

export type YtPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  imageUrl?: string;
};

const SERVICE = "youtube";

type YouTubeDebugInfo = {
  label: string;
  url: string;
  screenshot: string;
  html: string;
  json: string;
  visibleMenuText: string[];
  visibleDialogText: string[];
  bodySample: string;
};

async function withContext<T>(
  fn: (ctx: BrowserContext, page: Page) => Promise<T>,
  opts?: { humanize?: boolean },
): Promise<T> {
  if (sessionReuseEnabled()) {
    const session = await acquireSession(SERVICE);
    const result = await fn(session.context, session.page);
    if (process.env.SAVE_STATE_AFTER_RUN === "true") {
      await saveStorageState(SERVICE, session.context);
    }
    return result;
  }
  const session = await openWorkerBrowser({ service: SERVICE, humanize: opts?.humanize });
  try {
    const result = await fn(session.context, session.page);
    if (process.env.SAVE_STATE_AFTER_RUN === "true") {
      await saveStorageState(SERVICE, session.context);
    }
    return result;
  } finally {
    await session.close();
  }
}

function sanitizeDebugLabel(label: string): string {
  return label
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function maybeDebug(page: Page, label: string): Promise<void> {
  if (process.env.YT_DEBUG !== "true") return;
  await page.screenshot({ path: debugArtifactPath(`${label}.png`), fullPage: true });
  fs.writeFileSync(debugArtifactPath(`${label}.html`), await page.content());
  console.log(`[yt:debug] saved worker/state/${label}.png and .html`);
  console.log(`[yt:debug] current URL: ${page.url()}`);
}

async function captureUiDebug(page: Page, label: string, error: unknown): Promise<YouTubeDebugInfo> {
  const safeLabel = sanitizeDebugLabel(label || "yt-ui-error") || "yt-ui-error";
  const screenshot = debugArtifactPath(`${safeLabel}.png`);
  const html = debugArtifactPath(`${safeLabel}.html`);
  const json = debugArtifactPath(`${safeLabel}.json`);

  const pageState = await page
    .evaluate(() => {
      const isVisible = (element: Element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const textFrom = (selector: string) =>
        Array.from(document.querySelectorAll(selector))
          .filter(isVisible)
          .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 20);

      return {
        visibleMenuText: textFrom('tp-yt-paper-listbox [role="option"], [role="menuitem"], ytmusic-menu-popup-renderer *'),
        visibleDialogText: textFrom('tp-yt-paper-dialog, ytmusic-popup-container, ytmusic-add-to-playlist-renderer, [role="dialog"]'),
        bodySample: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 2000),
      };
    })
    .catch(() => ({ visibleMenuText: [], visibleDialogText: [], bodySample: "" }));

  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  fs.writeFileSync(html, await page.content().catch(() => ""));

  const info: YouTubeDebugInfo = {
    label: safeLabel,
    url: page.url(),
    screenshot,
    html,
    json,
    visibleMenuText: pageState.visibleMenuText,
    visibleDialogText: pageState.visibleDialogText,
    bodySample: pageState.bodySample,
  };

  fs.writeFileSync(
    json,
    JSON.stringify(
      {
        ...info,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
      },
      null,
      2,
    ),
  );

  return info;
}

async function runUiAction<T>(page: Page, label: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const debug = await captureUiDebug(page, label, error);
    const details = {
      label: debug.label,
      url: debug.url,
      screenshot: debug.screenshot,
      html: debug.html,
      json: debug.json,
      visibleMenuText: debug.visibleMenuText,
      visibleDialogText: debug.visibleDialogText,
    };
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[yt:debug:error] ${JSON.stringify(details)}`);
    throw new Error(`${message}\nYouTube UI debug: ${JSON.stringify(details)}`);
  }
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await sleep(1500);
}

async function assertLoggedIn(page: Page): Promise<void> {
  const state = await page.evaluate(() => {
    const body = document.body.innerText.slice(0, 1500);
    const hasSignIn = !!document.querySelector('a[href*="accounts.google.com"], a[href*="signin"], ytmusic-button-renderer a[href*="signin"]');
    const hasAvatar = !!document.querySelector(
      'img#img.ytmusic-settings-button, ytmusic-settings-button img, button[aria-label*="account" i] img, button[aria-label*="avatar" i] img',
    );
    return { hasSignIn, hasAvatar, body };
  });

  if (state.hasSignIn || /sign in/i.test(state.body)) {
    throw new Error("YouTube Music session is not logged in. Run: npm run chrome && npm run login -- youtube cdp");
  }
}

async function scrollMainContent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const candidates = [
      document.querySelector("ytmusic-app-layout"),
      document.querySelector("#contents"),
      document.scrollingElement,
      document.documentElement,
    ].filter(Boolean) as Element[];

    const scrollable =
      candidates.find((el) => el.scrollHeight > el.clientHeight + 20) ||
      document.scrollingElement ||
      document.documentElement;
    const before = scrollable.scrollTop;
    scrollable.scrollBy({ top: Math.max(600, Math.floor(scrollable.clientHeight * 0.85)), behavior: "auto" });
    return scrollable.scrollTop > before;
  });
}

async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of [document.querySelector("ytmusic-app-layout"), document.querySelector("#contents"), document.scrollingElement, document.documentElement]) {
      el?.scrollTo({ top: 0, behavior: "auto" });
    }
  });
  await sleep(500);
}

export async function listYouTubePlaylists(): Promise<YtPlaylist[]> {
  return withContext(async (_ctx, page) => {
    await page.goto(SERVICE_URLS.youtube.playlists!, { waitUntil: "domcontentloaded" });
    await settle(page);
    await assertLoggedIn(page);
    await maybeDebug(page, "yt-playlists");

    const byId = new Map<string, YtPlaylist>();
    await scrollToTop(page);

    for (let i = 0; i < 30; i++) {
      const visible = await extractVisiblePlaylists(page);
      for (const item of visible) byId.set(item.id, item);
      const moved = await scrollMainContent(page);
      await sleep(700);
      if (!moved) break;
    }

    return Array.from(byId.values());
  }, { humanize: false });
}

async function extractVisiblePlaylists(page: Page): Promise<YtPlaylist[]> {
  return page.evaluate(() => {
      const out: Array<{ id: string; name: string; trackCount: number; imageUrl?: string }> = [];
      const seen = new Set<string>();

      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="playlist?list="]'));
      for (const a of anchors) {
        const m = a.href.match(/list=([A-Za-z0-9_-]+)/);
        const id = m?.[1];
        if (!id || seen.has(id)) continue;

        const card =
          a.closest("ytmusic-two-row-item-renderer") ||
          a.closest("ytmusic-responsive-list-item-renderer") ||
          a.closest("ytmusic-grid-renderer");
        const scope: Element = card || a;
        const name = (
          a.getAttribute("title") ||
          scope.querySelector("yt-formatted-string.title a, .title a")?.textContent ||
          scope.querySelector("yt-formatted-string.title, .title")?.textContent ||
          ""
        ).trim();
        if (!name) continue;

        const subtitle = (scope.querySelector("yt-formatted-string.subtitle, .subtitle")?.textContent || "").trim();
        const trackMatch = subtitle.match(/(\d+)\s*(song|songs|track|tracks|ieraksts|ieraksti|dziesma|dziesmas)/i);
        const trackCount = trackMatch ? parseInt(trackMatch[1], 10) : 0;
        const imageUrl = (scope.querySelector("img") as HTMLImageElement | null)?.src;

        seen.add(id);
        out.push({ id, name, trackCount, imageUrl });
      }

      return out;
  });
}

function parseDurationMs(value: string): number | undefined {
  const parts = value
    .trim()
    .split(":")
    .map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return undefined;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return undefined;
}

function isMediaTypeLabel(value: string): boolean {
  return /^(song|songs|video|videos|track|tracks|dziesma|dziesmas|videoklips|videoklipi)$/i.test(value.trim());
}

function cleanArtist(value: string): string {
  return value
    .replace(/\s+\d[\d.,\s]*(k|m|b|tūkst\.|milj\.|mljrd\.)?\s+(views|view|skatījumu|atskaņošanas reizes).*$/i, "")
    .trim();
}

async function extractVisibleTracks(page: Page): Promise<NormalizedTrack[]> {
  const raw = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("ytmusic-responsive-list-item-renderer"));
    return rows
      .map((row) => {
        const titleEl =
          row.querySelector("yt-formatted-string.title a") ||
          row.querySelector("yt-formatted-string.title") ||
          row.querySelector(".title a") ||
          row.querySelector(".title");
        const title = (titleEl?.textContent || "").trim();
        const href = (titleEl as HTMLAnchorElement | null)?.href || row.querySelector<HTMLAnchorElement>('a[href*="watch?v="]')?.href || "";
        const videoId = href.match(/[?&]v=([A-Za-z0-9_-]+)/)?.[1] || row.getAttribute("data-video-id") || "";

        const subtitleText = (
          row.querySelector(".secondary-flex-columns")?.textContent ||
          row.querySelector("yt-formatted-string.flex-column")?.textContent ||
          row.querySelector(".subtitle")?.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        const duration = (row.querySelector(".fixed-column")?.textContent || "").trim();
        const imgEl = row.querySelector("img") as HTMLImageElement | null;
        const imageUrl = imgEl?.src || "";

        return { title, href, videoId, subtitleText, duration, imageUrl };
      })
      .filter((track) => track.title && track.videoId);
  });

  const byId = new Map<string, NormalizedTrack>();
  for (const track of raw) {
    const subtitleParts = track.subtitleText
      .split(/\s*(?:\u2022|·|•)\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    const startsWithType = subtitleParts[0] ? isMediaTypeLabel(subtitleParts[0]) : false;
    const artist = cleanArtist((startsWithType ? subtitleParts[1] : subtitleParts[0]) || "") || "Unknown artist";
    const album = startsWithType ? subtitleParts[2] : subtitleParts[1];

    byId.set(track.videoId, {
      title: track.title,
      artists: [artist],
      album,
      durationMs: parseDurationMs(track.duration),
      sourceService: "youtube",
      sourceTrackId: track.videoId,
      url: track.href || `https://music.youtube.com/watch?v=${track.videoId}`,
      imageUrl: track.imageUrl || undefined,
    });
  }

  return Array.from(byId.values());
}

async function collectPlaylistTracks(page: Page): Promise<NormalizedTrack[]> {
  const byId = new Map<string, NormalizedTrack>();
  const expectedCount = await getExpectedPlaylistTrackCount(page);
  await scrollToTop(page);

  for (let i = 0; i < 80; i++) {
    const visible = await extractVisibleTracks(page);
    for (const track of visible) byId.set(track.sourceTrackId, track);
    if (expectedCount && byId.size >= expectedCount) break;
    const moved = await scrollMainContent(page);
    await sleep(700);
    if (!moved) break;
  }

  const tracks = Array.from(byId.values());
  return expectedCount ? tracks.slice(0, expectedCount) : tracks;
}

async function getExpectedPlaylistTrackCount(page: Page): Promise<number | undefined> {
  return page.evaluate(() => {
    const text = document.body.innerText.replace(/\s+/g, " ");
    const match = text.match(/(\d+)\s*(song|songs|track|tracks|ieraksts|ieraksti|dziesma|dziesmas)/i);
    return match ? Number(match[1]) : undefined;
  });
}

export async function listYouTubePlaylistTracks(playlistId: string): Promise<NormalizedTrack[]> {
  return withContext(async (_ctx, page) => {
    await page.goto(`https://music.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await assertLoggedIn(page);
    await maybeDebug(page, "yt-playlist-tracks");
    return collectPlaylistTracks(page);
  }, { humanize: false });
}

export async function searchYouTubeTracks(query: string): Promise<NormalizedTrack[]> {
  return withContext(async (_ctx, page) => {
    await page.goto(`https://music.youtube.com/search?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await assertLoggedIn(page);
    await maybeDebug(page, "yt-search");
    return extractVisibleTracks(page);
  }, { humanize: false });
}

async function openAddToPlaylistForFirstResult(page: Page): Promise<void> {
  const saveSelectors = [
    'ytmusic-card-shelf-renderer button[aria-label*="playlist" i]',
    'ytmusic-card-shelf-renderer button[aria-label*="atskaņošanas sarakst" i]',
    'ytmusic-responsive-list-item-renderer button[aria-label*="playlist" i]',
    'ytmusic-responsive-list-item-renderer button[aria-label*="atskaņošanas sarakst" i]',
  ];

  for (const selector of saveSelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await humanHoverClick(page, locator);
      return;
    }
  }

  const menuSelectors = [
    'ytmusic-responsive-list-item-renderer:first-of-type tp-yt-paper-icon-button[aria-label*="Action menu" i]',
    'ytmusic-shelf-renderer ytmusic-responsive-list-item-renderer tp-yt-paper-icon-button[aria-label*="Action menu" i]',
    'ytmusic-responsive-list-item-renderer tp-yt-paper-icon-button[aria-label*="More" i]',
    'ytmusic-responsive-list-item-renderer button[aria-label*="More" i]',
    'ytmusic-card-shelf-renderer ytmusic-menu-renderer button[aria-label*="Darbību" i]',
    'ytmusic-responsive-list-item-renderer ytmusic-menu-renderer button[aria-label*="Darbību" i]',
    'ytmusic-menu-renderer button[aria-label*="Darbību" i]',
  ];

  for (const selector of menuSelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await humanHoverClick(page, locator);
      return;
    }
  }

  throw new Error("Could not find a save button or action menu in YouTube Music search results.");
}

async function chooseMenuItem(page: Page, label: RegExp): Promise<void> {
  const item = page.getByRole("menuitem", { name: label }).first();
  await humanDwell(250, 900);
  await runUiAction(page, "yt-menu-item-click", () => item.click({ timeout: 10_000 }));
}

async function choosePlaylistInDialog(page: Page, playlistNameOrId: string): Promise<void> {
  const dialog = page.locator("ytmusic-add-to-playlist-renderer").first();
  await runUiAction(page, "yt-add-playlist-dialog", () => dialog.waitFor({ state: "visible", timeout: 15_000 }));

  const option = dialog
    .locator("ytmusic-playlist-add-to-option-renderer")
    .filter({ hasText: playlistNameOrId })
    .first();
  await humanDwell(300, 1200);
  if ((await option.count()) > 0) {
    await runUiAction(page, "yt-playlist-option-click", () => option.click({ timeout: 15_000 }));
  } else {
    await runUiAction(page, "yt-playlist-text-click", () => dialog.getByText(playlistNameOrId, { exact: false }).first().click({ timeout: 15_000 }));
  }

  const doneButton = page.getByRole("button", { name: /done|save/i }).first();
  if ((await doneButton.count()) > 0) {
    await doneButton.click({ timeout: 5000 }).catch(() => {});
  }
}

async function findVisibleTrackRow(page: Page, trackText: string): Promise<Locator> {
  await scrollToTop(page);

  for (let i = 0; i < 80; i++) {
    let row = page.locator("ytmusic-responsive-list-item-renderer").filter({ hasText: trackText }).first();
    if ((await row.count()) > 0) return row;

    row = page.locator(`ytmusic-responsive-list-item-renderer:has(a[href*="v=${trackText}"])`).first();
    if ((await row.count()) > 0) return row;

    const moved = await scrollMainContent(page);
    await sleep(500);
    if (!moved) break;
  }

  throw new Error(`Could not find "${trackText}" in the visible playlist rows.`);
}

export async function addFirstSearchResultToPlaylist(query: string, playlistNameOrId: string): Promise<void> {
  let target = playlistNameOrId;
  if (/^PL[A-Za-z0-9_-]+$/.test(playlistNameOrId)) {
    const playlist = (await listYouTubePlaylists()).find((item) => item.id === playlistNameOrId);
    target = playlist?.name || playlistNameOrId;
  }

  return withContext(async (_ctx, page) => {
    const searchUrl = `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
    await settle(page);
    await assertLoggedIn(page);
    await maybeDebug(page, "yt-search");

    await runUiAction(page, "yt-open-add-to-playlist", () => openAddToPlaylistForFirstResult(page));
    if ((await page.getByRole("menuitem").count()) > 0) {
      await chooseMenuItem(page, /save to playlist|add to playlist|saglabāt.*atskaņošanas sarakst|pievienot.*atskaņošanas sarakst/i);
    }
    await choosePlaylistInDialog(page, target);
    await sleep(1000);
  });
}

function words(value: string): string[] {
  return value.split(/\s+/).filter((word) => word.length > 2);
}

function isDuplicateTrack(candidate: NormalizedTrack, playlistTrack: NormalizedTrack, query?: string): boolean {
  if (candidate.sourceTrackId && candidate.sourceTrackId === playlistTrack.sourceTrackId) return true;
  if (candidate.isrc && candidate.isrc === playlistTrack.isrc) return true;

  const candidateTitle = normalizeTitle(candidate.title);
  const playlistTitle = normalizeTitle(playlistTrack.title);
  const candidateArtist = normalizeArtist(candidate.artists[0] || "");
  const playlistArtist = normalizeArtist(playlistTrack.artists[0] || "");
  const normalizedQuery = normalizeTitle(query || "");

  if (playlistTitle && candidateTitle.includes(playlistTitle)) return true;
  if (playlistTitle && normalizedQuery.includes(playlistTitle)) return true;
  if (playlistTitle && words(playlistTitle).length >= 2 && words(playlistTitle).every((word) => normalizedQuery.includes(word))) return true;

  return Boolean(candidateTitle && playlistTitle && candidateTitle === playlistTitle && candidateArtist && playlistArtist && candidateArtist === playlistArtist);
}

export async function addFirstSearchResultToPlaylistIfMissing(query: string, playlistNameOrId: string): Promise<{ added: boolean; duplicate?: NormalizedTrack }> {
  const candidates = await searchYouTubeTracks(query);
  const candidate = candidates[0];
  if (!candidate) throw new Error(`No YouTube Music search result for "${query}".`);

  if (/^PL[A-Za-z0-9_-]+$/.test(playlistNameOrId)) {
    const playlistTracks = await listYouTubePlaylistTracks(playlistNameOrId);
    const duplicate = playlistTracks.find((track) => isDuplicateTrack(candidate, track, query));
    if (duplicate) return { added: false, duplicate };
  }

  await addFirstSearchResultToPlaylist(query, playlistNameOrId);
  return { added: true };
}

export async function removeTrackFromPlaylist(playlistId: string, trackText: string): Promise<void> {
  return withContext(async (_ctx, page) => {
    await page.goto(`https://music.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await assertLoggedIn(page);

    const row = await runUiAction(page, "yt-remove-find-track-row", () => findVisibleTrackRow(page, trackText));
    await row.scrollIntoViewIfNeeded({ timeout: 10_000 });
    await row.hover({ timeout: 10_000 }).catch(() => {});
    await humanDwell(400, 1600);
    await runUiAction(page, "yt-remove-open-action-menu", () =>
      row
        .locator(
          'tp-yt-paper-icon-button[aria-label*="Action menu" i], button[aria-label*="More" i], ytmusic-menu-renderer button[aria-label*="Darbību" i]',
        )
        .first()
        .click({ timeout: 10_000, force: true }),
    );
    await chooseMenuItem(page, /remove from playlist|noņemt.*atskaņošanas sarakst|noņemt.*sarakst/i);
    await sleep(1000);
  });
}

async function main() {
  const command = process.argv[2] || "list";

  if (command === "list") {
    const items = await listYouTubePlaylists();
    console.log(JSON.stringify(items, null, 2));
    console.log(`\nFound ${items.length} playlists.`);
    return;
  }

  if (command === "add") {
    const playlist = process.argv[3];
    const query = process.argv.slice(4).join(" ");
    if (!playlist || !query) {
      throw new Error('Usage: npm run yt -- add "<playlist name or id>" "<artist - title>"');
    }
    const result = await addFirstSearchResultToPlaylistIfMissing(query, playlist);
    if (result.added) {
      console.log(`[yt:add] Added first search result for "${query}" to "${playlist}".`);
    } else {
      console.log(`[yt:add] Already in playlist: ${result.duplicate?.title || query}`);
    }
    return;
  }

  if (command === "tracks") {
    const playlistId = process.argv[3];
    if (!playlistId) {
      throw new Error('Usage: npm run yt -- tracks "<playlist id>"');
    }
    const items = await listYouTubePlaylistTracks(playlistId);
    console.log(JSON.stringify(items, null, 2));
    console.log(`\nFound ${items.length} tracks.`);
    return;
  }

  if (command === "search") {
    const query = process.argv.slice(3).join(" ");
    if (!query) {
      throw new Error('Usage: npm run yt -- search "<artist - title>"');
    }
    const items = await searchYouTubeTracks(query);
    console.log(JSON.stringify(items, null, 2));
    console.log(`\nFound ${items.length} tracks.`);
    return;
  }

  if (command === "remove") {
    const playlistId = process.argv[3];
    const trackText = process.argv.slice(4).join(" ");
    if (!playlistId || !trackText) {
      throw new Error('Usage: npm run yt -- remove "<playlist id>" "<track text>"');
    }
    await removeTrackFromPlaylist(playlistId, trackText);
    console.log(`[yt:remove] Removed matching track "${trackText}" from playlist ${playlistId}.`);
    return;
  }

  throw new Error("Usage: npm run yt -- list | tracks | search | add | remove");
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
