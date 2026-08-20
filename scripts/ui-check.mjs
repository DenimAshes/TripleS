// UI check harness. Two modes over one login:
//   node scripts/ui-check.mjs            screenshots every page at 1440 and 390
//   node scripts/ui-check.mjs --smoke    walks the app and reports console
//                                        errors, failed requests and dead links
//
// Needs a dev server on BASE (npm run dev) and ADMIN_EMAIL/ADMIN_PASSWORD in
// .env — the same credentials prisma/seed.ts used.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.UI_CHECK_BASE || "http://127.0.0.1:3000";
const OUT = ".design-audit";
const SMOKE = process.argv.includes("--smoke");

const PAGES = [
  ["dashboard", "/dashboard"],
  ["connections", "/connections"],
  ["playlists", "/playlists"],
  ["manual-match", "/manual-match"],
  ["history", "/history"],
  ["settings", "/settings"],
  ["youtube-browser", "/youtube-browser"],
  ["soundcloud-browser", "/soundcloud-browser"],
  ["admin-sessions", "/admin/sessions"],
];

const MOBILE_PAGES = ["dashboard", "playlists", "settings", "connections", "youtube-browser"];

// PAGES is also the sidebar contract, so it can only hold static routes.
// /playlists/[id] is a real page with its own hero, table and dialogs, and it
// was the one screen no run ever looked at - which is how it kept printing the
// playlist name twice, as the page h1 and again in the hero below it. Discover
// the first playlist at runtime and walk that too.
async function routes(page) {
  await page.goto(`${BASE}/playlists`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(1200);
  const href = await page
    .$$eval("main a[href^='/playlists/']", (nodes) => nodes.map((n) => n.getAttribute("href"))[0] || null)
    .catch(() => null);
  if (!href) {
    console.log("note: no playlist to open, skipping /playlists/[id]");
    return PAGES;
  }
  return [...PAGES, ["playlist-detail", href]];
}

function readEnv() {
  if (!fs.existsSync(".env")) return {};
  return Object.fromEntries(
    fs
      .readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^"|"$/g, "")];
      }),
  );
}

const env = readEnv();
const problems = [];

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.fill('input[name="email"]', env.ADMIN_EMAIL || "admin@example.com");
  await page.fill('input[name="password"]', env.ADMIN_PASSWORD || "changeme");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 90_000 });
}

// Console errors and 4xx/5xx responses are attributed to whatever page is
// loaded when they arrive, so a silent regression shows up as a named problem
// rather than a wall of log lines.
function watch(page, label) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // React dev builds warn about hydration timing noise that is not a defect.
    if (/Download the React DevTools/.test(text)) return;
    problems.push(`console  ${label()}  ${text.slice(0, 220)}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror  ${label()}  ${String(error).slice(0, 220)}`));
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    problems.push(`http ${status}  ${label()}  ${response.url().replace(BASE, "")}`);
  });
}

async function screenshots(browser) {
  fs.mkdirSync(OUT, { recursive: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await desktop.newPage();
  let current = "/login";
  watch(page, () => current);
  await login(page);
  const pages = await routes(page);

  for (const [name, url] of pages) {
    current = url;
    await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) problems.push(`overflow-x ${overflow}px  ${url}  (1440)`);
    console.log(`shot ${url}`);
  }

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: await desktop.storageState(),
  });
  const mp = await mobile.newPage();
  watch(mp, () => `${current} (390)`);
  for (const name of MOBILE_PAGES) {
    const url = PAGES.find(([key]) => key === name)?.[1];
    current = url;
    await mp.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await mp.waitForTimeout(1800);
    await mp.screenshot({ path: path.join(OUT, `m-${name}.png`), fullPage: true });
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) problems.push(`overflow-x ${overflow}px  ${url}  (390)`);
    console.log(`shot mobile ${url}`);
  }
}

async function smoke(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  let current = "/login";
  watch(page, () => current);
  await login(page);

  // Every page must be reachable from the sidebar, and every sidebar entry must
  // land where it claims.
  const navHrefs = await page.$$eval("aside a[href]", (nodes) => nodes.map((n) => n.getAttribute("href")));
  for (const [, url] of PAGES) {
    if (!navHrefs.includes(url)) problems.push(`unreachable  ${url} is not linked from the sidebar`);
  }

  // The discovered playlist page is reached from /playlists, not the sidebar, so
  // it joins the walk but not the reachability check above.
  const pages = await routes(page);
  for (const [, url] of pages) {
    current = url;
    await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(1500);

    // Internal links must resolve; external ones are left alone.
    const links = await page.$$eval("main a[href^='/']", (nodes) =>
      Array.from(new Set(nodes.map((n) => n.getAttribute("href")))).filter(Boolean),
    );
    for (const href of links) {
      if (href.startsWith("/api/")) continue;
      const response = await page.request.get(BASE + href).catch(() => null);
      if (!response) problems.push(`link  ${url} -> ${href} request failed`);
      else if (response.status() >= 400) problems.push(`link ${response.status()}  ${url} -> ${href}`);
    }

    // Only buttons named here get clicked. This used to be a blacklist of
    // mutating labels, which fails open: "Use" and "Skip" on /manual-match were
    // not on it, so a smoke run resolved 30 real review items. An allowlist
    // fails closed instead - an unrecognised button is skipped and reported.
    const SAFE_CLICK =
      /^(all|done|needs attention|failed|filter|filters|clear filters|show|hide|show more|show less|more|less|expand|collapse|close|dismiss|run history|sort|next|previous|prev|paste json instead|jump)\b/i;
    const buttons = await page.$$("main button:not([disabled])");
    const labels = [];
    for (const button of buttons) {
      labels.push(((await button.textContent()) || "").trim().replace(/\s+/g, " "));
    }
    let clicked = 0;
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index];
      if (!label || !SAFE_CLICK.test(label)) continue;
      // Re-query: a click can re-render the list, which detaches a handle
      // captured before it - that reported as a failure when it was not one.
      const live = (await page.$$("main button:not([disabled])"))[index];
      if (!live) continue;
      const stillLabel = ((await live.textContent()) || "").trim().replace(/\s+/g, " ");
      if (stillLabel !== label) continue;
      clicked += 1;
      await live.click({ timeout: 4000 }).catch((err) => problems.push(`click  ${url}  "${label}"  ${String(err).slice(0, 90)}`));
      await page.waitForTimeout(180);
      await page.keyboard.press("Escape").catch(() => {});
    }
    const unexercised = [...new Set(labels.filter((label) => label && !SAFE_CLICK.test(label)))];
    console.log(`walked ${url} (${links.length} links, ${clicked}/${buttons.length} buttons clicked)`);
    if (unexercised.length) console.log(`  not clicked: ${unexercised.join(" | ")}`);
  }

  // Mobile: the More sheet is the only route to the pages that don't fit.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
  const mp = await mobile.newPage();
  watch(mp, () => "mobile nav");
  await mp.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await mp.getByRole("button", { name: "More" }).click();
  for (const href of ["/history", "/youtube-browser", "/soundcloud-browser", "/admin/sessions"]) {
    const count = await mp.locator(`nav ~ div a[href="${href}"], div a[href="${href}"]`).count();
    if (!count) problems.push(`unreachable  ${href} missing from the mobile More sheet`);
  }
}

const browser = await chromium.launch();
try {
  if (SMOKE) await smoke(browser);
  else await screenshots(browser);
} finally {
  await browser.close();
}

console.log("");
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const problem of problems) console.log("  -", problem);
  process.exitCode = 1;
} else {
  console.log("no problems found");
}
