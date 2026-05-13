import type { Page } from "playwright";
import { openWorkerBrowser, saveStorageState } from "./browserSession";
import { SERVICE_URLS, SERVICES, parseService, type BrowserMode, type ServiceId } from "./config";

function parseMode(service: ServiceId): BrowserMode {
  const idx = process.argv.indexOf("--mode");
  const value = idx >= 0 ? process.argv[idx + 1] : process.argv[3] || process.env.LOGIN_BROWSER || process.env.WORKER_BROWSER;
  if (value === "firefox" || value === "chrome" || value === "cdp" || value === "state") return value;
  return service === "youtube" || service === "soundcloud" ? "cdp" : "chrome";
}

async function isLoggedIn(service: ServiceId, page: Page): Promise<boolean> {
  if (service === "youtube") {
    return page.evaluate(() => {
      const body = document.body.innerText.slice(0, 1500);
      const hasAvatar = !!document.querySelector(
        'img#img.ytmusic-settings-button, ytmusic-settings-button img, button[aria-label*="account" i] img, button[aria-label*="avatar" i] img',
      );
      const hasSignIn = !!document.querySelector('a[href*="accounts.google.com"], a[href*="signin"], ytmusic-button-renderer a[href*="signin"]');
      return hasAvatar && !hasSignIn && !/sign in/i.test(body);
    });
  }

  if (service === "spotify") {
    return page.evaluate(() => {
      const hasUserWidget = !!document.querySelector('[data-testid="user-widget-link"], button[data-testid="user-widget-avatar"]');
      const hasLogin = !!document.querySelector('a[href*="/login"], button[data-testid="login-button"]');
      return hasUserWidget && !hasLogin;
    });
  }

  return page.evaluate(() => {
    const hasUserNav = !!document.querySelector(".header__userNav, .header__userNavAvatar, a[href*='/you/library']");
    const hasLogin = !!document.querySelector("button.signinButton, a[href*='/signin']");
    return hasUserNav && !hasLogin;
  });
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

async function main() {
  const service = parseService(process.argv[2]);
  if (!service) {
    console.error(`Usage: npm run login -- <service> [firefox|chrome|cdp]\n  service: ${SERVICES.join(" | ")}`);
    console.error("For Google/Youtube, recommended path:");
    console.error("  npm run chrome -- youtube");
    console.error("  npm run login -- youtube cdp");
    console.error("For SoundCloud sign-in with Google:");
    console.error("  npm run chrome -- soundcloud");
    console.error("  npm run login -- soundcloud cdp");
    process.exit(1);
  }

  const mode = parseMode(service);
  const cfg = SERVICE_URLS[service];

  console.log(`\n[login:${service}] Browser mode: ${mode}`);
  if (mode === "cdp") {
    console.log(`[login] Attaching to a real Chrome over CDP. Start it first with: npm run chrome -- ${service}`);
  }
  console.log("[login] Finish login in the browser, wait for the avatar/library to render, then press Enter here.\n");

  const session = await openWorkerBrowser({
    service,
    mode,
    headless: false,
    requireState: false,
  });

  try {
    await session.page.goto(cfg.home, { waitUntil: "domcontentloaded" });
    await waitForEnter();

    const ok = await isLoggedIn(service, session.page).catch(() => false);
    if (!ok) {
      console.error(`\n[login:${service}] Login was not detected.`);
      console.error(`[login:${service}] Current URL: ${session.page.url()}`);
      console.error("[login] Keep the browser open, finish login, then rerun this command.");
      process.exitCode = 2;
      return;
    }

    const outFile = await saveStorageState(service, session.context);
    console.log(`[login:${service}] Login verified. Session saved to ${outFile}`);
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
