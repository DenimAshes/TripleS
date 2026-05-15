import fs from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { launch, launchContext, launchPersistentContext } from "cloakbrowser";
import {
  DEFAULT_CDP_URL,
  chromeProfilePath,
  ensureStateDir,
  stateFilePath,
  type BrowserMode,
  type ServiceId,
} from "./config";

export type WorkerBrowserSession = {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
};

export type WorkerBrowserOptions = {
  service: ServiceId;
  mode?: BrowserMode;
  headless?: boolean;
  humanize?: boolean;
  requireState?: boolean;
  cdpUrl?: string;
};

function browserMode(): BrowserMode {
  const value = process.env.WORKER_BROWSER || process.env.BROWSER_MODE;
  if (value === "chrome" || value === "cdp" || value === "state" || value === "profile") return value;
  return "state";
}

function cdpUrlForService(service: ServiceId, override?: string): string {
  return (
    override ||
    process.env[`CDP_URL_${service.toUpperCase()}`] ||
    process.env.CDP_URL ||
    DEFAULT_CDP_URL
  );
}

function resolveHumanize(service: ServiceId, override?: boolean): boolean {
  if (override !== undefined) return override;
  if (process.env.WORKER_HUMANIZE === "true") return true;
  if (process.env.WORKER_HUMANIZE === "false") return false;
  return service === "youtube" || service === "soundcloud";
}

export function deterministicSeed(service: ServiceId): number {
  let h = 5381;
  for (let i = 0; i < service.length; i += 1) {
    h = ((h << 5) + h) ^ service.charCodeAt(i);
  }
  return 10000 + (Math.abs(h) % 90000);
}

export function fingerprintSeed(service: ServiceId): number {
  const explicit =
    process.env[`WORKER_FP_SEED_${service.toUpperCase()}`] ||
    process.env.WORKER_FP_SEED;
  if (explicit) {
    const n = Number.parseInt(explicit, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return deterministicSeed(service);
}

export function extraStealthArgs(service: ServiceId): string[] {
  const args = [`--fingerprint=${fingerprintSeed(service)}`];
  const platform = process.env.WORKER_FP_PLATFORM;
  if (platform) args.push(`--fingerprint-platform=${platform}`);
  const quota = process.env.WORKER_STORAGE_QUOTA_MB;
  if (quota) args.push(`--fingerprint-storage-quota=${quota}`);
  const webrtc = process.env.WORKER_WEBRTC_IP;
  if (webrtc) args.push(`--fingerprint-webrtc-ip=${webrtc}`);
  if (process.env.WORKER_FP_NOISE === "false") args.push("--fingerprint-noise=false");
  if (process.env.WORKER_DISABLE_HTTP2 === "true") args.push("--disable-http2");
  return args;
}

function parseNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseRangeEnv(name: string): [number, number] | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    return [parts[0], parts[1]];
  }
  return undefined;
}

function humanConfig(): Record<string, unknown> | undefined {
  const cfg: Record<string, unknown> = {};
  const typingDelay = parseNumberEnv("WORKER_HUMAN_TYPING_DELAY_MS");
  if (typingDelay !== undefined) cfg.typing_delay = typingDelay;
  const mistype = parseNumberEnv("WORKER_HUMAN_MISTYPE_RATE");
  if (mistype !== undefined) cfg.mistype_chance = mistype;
  if (process.env.WORKER_HUMAN_IDLE_BETWEEN === "true") cfg.idle_between_actions = true;
  if (process.env.WORKER_HUMAN_IDLE_BETWEEN === "false") cfg.idle_between_actions = false;
  const idleRange = parseRangeEnv("WORKER_HUMAN_IDLE_RANGE_SEC");
  if (idleRange) cfg.idle_between_duration = idleRange;
  return Object.keys(cfg).length ? cfg : undefined;
}

function humanPreset(): "default" | "careful" | undefined {
  const raw = process.env.WORKER_HUMAN_PRESET;
  if (!raw) return undefined;
  if (raw === "default" || raw === "careful") return raw;
  console.warn(`[worker] Ignoring WORKER_HUMAN_PRESET="${raw}" — expected "default" or "careful".`);
  return undefined;
}

function commonOptions(service: ServiceId, headless: boolean, humanize: boolean) {
  return {
    headless,
    humanize,
    humanPreset: humanPreset(),
    humanConfig: humanConfig(),
    viewport: { width: 1280, height: 800 } as const,
    locale: "en-US",
    proxy: process.env.WORKER_PROXY || undefined,
    geoip: process.env.WORKER_GEOIP === "true",
    args: extraStealthArgs(service),
  };
}

function configurePage(page: Page): Page {
  const timeout = Number(process.env.WORKER_PAGE_TIMEOUT_MS ?? 60_000);
  const navigationTimeout = Number(process.env.WORKER_NAVIGATION_TIMEOUT_MS ?? 60_000);
  page.setDefaultTimeout(Number.isFinite(timeout) && timeout > 0 ? timeout : 60_000);
  page.setDefaultNavigationTimeout(Number.isFinite(navigationTimeout) && navigationTimeout > 0 ? navigationTimeout : 60_000);
  return page;
}

function pageForService(context: BrowserContext, service: ServiceId): Page | undefined {
  const host =
    service === "youtube" ? "music.youtube.com" :
    service === "soundcloud" ? "soundcloud.com" :
    "open.spotify.com";
  return context.pages().find((page) => page.url().includes(host));
}

export async function openWorkerBrowser(options: WorkerBrowserOptions): Promise<WorkerBrowserSession> {
  ensureStateDir();

  const mode = options.mode || browserMode();
  const headless = options.headless ?? process.env.HEADLESS !== "false";
  const humanize = resolveHumanize(options.service, options.humanize);
  const statePath = stateFilePath(options.service);
  const base = commonOptions(options.service, headless, humanize);

  if (mode === "cdp") {
    const browser = await chromium.connectOverCDP(cdpUrlForService(options.service, options.cdpUrl));
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = configurePage(pageForService(context, options.service) || context.pages()[0] || (await context.newPage()));
    return {
      context,
      page,
      close: async () => {
        // For CDP connections this closes Playwright's connection handle. The
        // external browser process stays alive, but the runner can exit cleanly.
        await browser.close();
      },
    };
  }

  if (mode === "chrome") {
    const browser = await launch(base);
    const context = await browser.newContext({
      viewport: base.viewport,
    });
    const page = configurePage(await context.newPage());
    return {
      context,
      page,
      close: async () => {
        await browser.close();
      },
    };
  }

  if (mode === "profile") {
    const profilePath = chromeProfilePath(options.service);
    fs.mkdirSync(profilePath, { recursive: true });
    const context = await launchPersistentContext({
      ...base,
      userDataDir: profilePath,
    });
    const page = configurePage(pageForService(context, options.service) || context.pages()[0] || (await context.newPage()));
    return {
      context,
      page,
      close: async () => {
        await context.close();
      },
    };
  }

  if (!fs.existsSync(statePath)) {
    const hint =
      options.service === "youtube" || options.service === "soundcloud"
        ? `npm run chrome -- ${options.service} && npm run login -- ${options.service} cdp`
        : `npm run login -- ${options.service}`;
    throw new Error(`No saved ${options.service} browser session at ${statePath}. Run: ${hint}`);
  }

  const context = await launchContext({
    ...base,
    contextOptions: { storageState: statePath },
  });
  const page = configurePage(await context.newPage());

  return {
    context,
    page,
    close: async () => {
      await context.close();
    },
  };
}

export async function saveStorageState(service: ServiceId, context: BrowserContext): Promise<string> {
  ensureStateDir();
  const outFile = stateFilePath(service);
  await context.storageState({ path: outFile });
  return outFile;
}
