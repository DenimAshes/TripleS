import fs from "node:fs";
import { chromium, firefox, type Browser, type BrowserContext, type BrowserType, type Page } from "playwright";
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
  requireState?: boolean;
  cdpUrl?: string;
};

function browserMode(): BrowserMode {
  const value = process.env.WORKER_BROWSER || process.env.BROWSER_MODE;
  if (value === "firefox" || value === "chrome" || value === "cdp" || value === "state" || value === "profile") return value;
  return "state";
}

function chromeUserAgent(browser?: Browser): string {
  const major = browser?.version().split(".")[0] || "130";
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function trustedChromeArgs(): string[] {
  return [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-features=Translate,MediaRouter",
  ];
}

async function launchChrome(headless: boolean): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless, args: trustedChromeArgs() });
  } catch {
    return chromium.launch({ headless, args: trustedChromeArgs() });
  }
}

async function launchBrowser(type: BrowserType, headless: boolean): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await type.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  return { browser, context };
}

export async function openWorkerBrowser(options: WorkerBrowserOptions): Promise<WorkerBrowserSession> {
  ensureStateDir();

  const mode = options.mode || browserMode();
  const headless = options.headless ?? process.env.HEADLESS !== "false";
  const statePath = stateFilePath(options.service);

  if (mode === "cdp") {
    const browser = await chromium.connectOverCDP(options.cdpUrl || DEFAULT_CDP_URL);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    return {
      context,
      page,
      close: async () => {
        await browser.close();
      },
    };
  }

  if (mode === "firefox") {
    const { browser, context } = await launchBrowser(firefox, headless);
    const page = await context.newPage();
    return {
      context,
      page,
      close: async () => {
        await browser.close();
      },
    };
  }

  if (mode === "chrome") {
    const browser = await launchChrome(headless);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      userAgent: chromeUserAgent(browser),
    });
    const page = await context.newPage();
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
    const launchOptions = {
      headless,
      args: trustedChromeArgs(),
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    };
    const context = await chromium.launchPersistentContext(profilePath, {
      ...launchOptions,
      channel: "chrome",
    }).catch(() => chromium.launchPersistentContext(profilePath, launchOptions));
    const page = context.pages()[0] || (await context.newPage());
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

  const browser = await launchChrome(headless);
  const context = await browser.newContext({
    storageState: statePath,
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    userAgent: chromeUserAgent(browser),
  });
  const page = await context.newPage();

  return {
    context,
    page,
    close: async () => {
      await browser.close();
    },
  };
}

export async function saveStorageState(service: ServiceId, context: BrowserContext): Promise<string> {
  ensureStateDir();
  const outFile = stateFilePath(service);
  await context.storageState({ path: outFile });
  return outFile;
}
