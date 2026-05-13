import fs from "node:fs";
import type { Page } from "playwright";
import { openWorkerBrowser, saveStorageState } from "../browserSession";
import { debugArtifactPath, parseService, SERVICE_URLS, SERVICES, type ServiceId } from "../config";

export type BrowserPlaylist = {
  id: string;
  name: string;
  url: string;
};

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function maybeDebug(page: Page, service: ServiceId): Promise<void> {
  if (process.env.WORKER_DEBUG !== "true") return;
  await page.screenshot({ path: debugArtifactPath(`${service}-library.png`), fullPage: true });
  fs.writeFileSync(debugArtifactPath(`${service}-library.html`), await page.content());
}

function playlistPattern(service: ServiceId): RegExp {
  if (service === "youtube") return /playlist\?list=([A-Za-z0-9_-]+)/;
  if (service === "spotify") return /\/playlist\/([A-Za-z0-9]+)/;
  return /soundcloud\.com\/[^/]+\/sets\/([^/?#]+)/;
}

export async function listServicePlaylists(service: ServiceId): Promise<BrowserPlaylist[]> {
  const session = await openWorkerBrowser({ service });
  try {
    const url = SERVICE_URLS[service].playlists || SERVICE_URLS[service].home;
    await session.page.goto(url, { waitUntil: "domcontentloaded" });
    await settle(session.page);
    await maybeDebug(session.page, service);

    const pattern = playlistPattern(service).source;
    const items = await session.page.evaluate((source) => {
      const re = new RegExp(source);
      const out: Array<{ id: string; name: string; url: string }> = [];
      const seen = new Set<string>();

      for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
        const href = a.href;
        const match = href.match(re);
        const id = match?.[1];
        if (!id || seen.has(id)) continue;

        const name = (a.getAttribute("title") || a.getAttribute("aria-label") || a.textContent || "").trim();
        if (!name) continue;

        seen.add(id);
        out.push({ id, name, url: href });
      }

      return out;
    }, pattern);

    if (process.env.SAVE_STATE_AFTER_RUN === "true") {
      await saveStorageState(service, session.context);
    }

    return items;
  } finally {
    await session.close();
  }
}

async function main() {
  const service = parseService(process.argv[2]);
  if (!service) {
    throw new Error(`Usage: npm run library -- <service>\n  service: ${SERVICES.join(" | ")}`);
  }

  const items = await listServicePlaylists(service);
  console.log(JSON.stringify(items, null, 2));
  console.log(`\nFound ${items.length} ${service} playlists.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
