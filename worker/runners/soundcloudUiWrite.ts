import type { Page } from "playwright";

/**
 * SoundCloud's current layout writes playlist changes through a same-origin
 * server action on `/n/...`, not through `api-v2`. That endpoint is not behind
 * the DataDome challenge that blocks `PUT /playlists/{id}`, so driving the
 * "Add to playlist" dialog is the only write path that completes for this
 * account — headless included.
 */

const ADD_BUTTON_SELECTOR = "button[aria-label='Add to playlist']";
const ADDED_LABELS = /^(added|remove|remove from playlist)$/i;
const ADD_LABELS = /^add to playlist$/i;

export type UiToggleIntent = "add" | "remove";
export type UiToggleResult = { changed: boolean; label: string; rowText: string };

type RowState = { found: boolean; label?: string; text?: string; clicked?: boolean };

/** `https://soundcloud.com/artist/track` -> `artist/track` */
export function trackPagePath(permalinkUrl: string): string {
  try {
    const path = new URL(permalinkUrl).pathname.replace(/^\/+|\/+$/g, "");
    if (!path) throw new Error("empty path");
    return path;
  } catch {
    return permalinkUrl.replace(/^https?:\/\/[^/]+\/?/, "").replace(/^\/+|\/+$/g, "");
  }
}

async function dismissConsent(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      document
        .querySelectorAll("#onetrust-consent-sdk, .onetrust-pc-dark-filter, #onetrust-banner-sdk")
        .forEach((element) => element.remove());
      document.body.classList.remove("ot-overflow-hidden");
    })
    .catch(() => {});
}

async function dialogText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const dialog =
      Array.from(document.querySelectorAll("[role='dialog'], .MuiDialog-container, .MuiModal-root")).find((node) =>
        /Create playlist/i.test(node.textContent || ""),
      ) ?? null;
    return dialog ? (dialog.textContent || "").replace(/\s+/g, " ").trim() : "";
  });
}

async function openPickerDialog(page: Page): Promise<string> {
  await dismissConsent(page);
  const opened = await page.evaluate((selector) => {
    const button = document.querySelector(selector) as HTMLElement | null;
    if (!button) return false;
    button.scrollIntoView({ block: "center" });
    button.click();
    return true;
  }, ADD_BUTTON_SELECTOR);
  if (!opened) throw new Error("SoundCloud track page has no 'Add to playlist' button (layout changed or track unavailable).");

  // The playlist rows arrive asynchronously; wait until the dialog text settles.
  let previous = "";
  for (let attempt = 0; attempt < 14; attempt += 1) {
    await page.waitForTimeout(1500);
    await dismissConsent(page);
    const text = await dialogText(page);
    if (text && text === previous) return text;
    previous = text;
  }
  if (!previous) throw new Error("SoundCloud 'Add to playlist' dialog did not open.");
  return previous;
}

/**
 * Finds the action button belonging to one playlist, optionally clicking it.
 * It walks up from each button only while the ancestor still reads like a
 * single row, so the container holding every playlist can never match the
 * wrong one. Reading and clicking share one in-page pass so the two cannot
 * disagree about which row belongs to the playlist.
 */
async function inspectRow(page: Page, playlistTitle: string, click: boolean): Promise<RowState> {
  return page.evaluate(
    ({ title, shouldClick }) => {
      const dialog =
        Array.from(document.querySelectorAll("[role='dialog'], .MuiDialog-container, .MuiModal-root")).find((node) =>
          /Create playlist/i.test(node.textContent || ""),
        ) ?? null;
      if (!dialog) return { found: false };
      for (const button of Array.from(dialog.querySelectorAll("button"))) {
        const label = (button.textContent || "").trim();
        if (!/^(add to playlist|added|remove|remove from playlist)$/i.test(label)) continue;
        let node: HTMLElement | null = button as HTMLElement;
        for (let depth = 0; depth < 5 && node; depth += 1) {
          node = node.parentElement;
          if (!node) break;
          const text = (node.textContent || "").replace(/s+/g, " ").trim();
          if (text.length > 90) break;
          if (text.includes(title)) {
            if (shouldClick) (button as HTMLElement).click();
            return { found: true, label, text: text.slice(0, 90), clicked: shouldClick };
          }
        }
      }
      return { found: false };
    },
    { title: playlistTitle, shouldClick: click },
  );
}

function labelMeansPresent(label: string): boolean {
  return ADDED_LABELS.test(label);
}

export async function toggleTrackInPlaylistViaUi(
  page: Page,
  options: { trackPermalinkUrl: string; playlistTitle: string; intent: UiToggleIntent },
): Promise<UiToggleResult> {
  const { trackPermalinkUrl, playlistTitle, intent } = options;
  const path = trackPagePath(trackPermalinkUrl);
  if (!path) throw new Error(`SoundCloud track permalink is unusable: ${trackPermalinkUrl}`);

  await page.goto(`https://soundcloud.com/n/${path}?v2_layout=true`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4000);

  await openPickerDialog(page);
  const before = await inspectRow(page, playlistTitle, false);
  if (!before.found) {
    throw new Error(`SoundCloud 'Add to playlist' dialog has no row for "${playlistTitle}".`);
  }

  const present = labelMeansPresent(before.label ?? "");
  if ((intent === "add" && present) || (intent === "remove" && !present)) {
    return { changed: false, label: before.label ?? "", rowText: before.text ?? "" };
  }

  const clicked = await inspectRow(page, playlistTitle, true);
  if (!clicked.clicked) {
    throw new Error(`SoundCloud row for "${playlistTitle}" disappeared before it could be clicked.`);
  }

  // The row label flips once the server action returns, which is the only
  // in-page confirmation that the write landed.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.waitForTimeout(1500);
    const after = await inspectRow(page, playlistTitle, false);
    if (!after.found) continue;
    const nowPresent = labelMeansPresent(after.label ?? "");
    if (intent === "add" && nowPresent) return { changed: true, label: after.label ?? "", rowText: after.text ?? "" };
    if (intent === "remove" && !nowPresent && ADD_LABELS.test(after.label ?? "")) {
      return { changed: true, label: after.label ?? "", rowText: after.text ?? "" };
    }
  }

  throw new Error(`SoundCloud did not confirm the ${intent} for "${playlistTitle}" (row label never changed).`);
}

export const __testables = { labelMeansPresent };
