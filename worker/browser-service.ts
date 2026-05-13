import fs from "node:fs";
import { launchPersistentContext } from "cloakbrowser";
import { chromeProfilePath, parseService, SERVICES, SERVICE_URLS } from "./config";

function cdpPort(): number {
  const raw = Number(process.env.CDP_PORT || process.env.BROWSER_SERVICE_PORT || 9222);
  return Number.isFinite(raw) && raw > 0 ? raw : 9222;
}

async function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

async function main() {
  const service = parseService(process.argv[2]) || "youtube";
  const profile = chromeProfilePath(service);
  fs.mkdirSync(profile, { recursive: true });

  const port = cdpPort();
  console.log(`[browser:${service}] Profile: ${profile}`);
  console.log(`[browser:${service}] CDP: http://0.0.0.0:${port}`);
  console.log(`[browser:${service}] Opening: ${SERVICE_URLS[service].home}`);

  const context = await launchPersistentContext({
    userDataDir: profile,
    headless: process.env.HEADLESS === "true",
    viewport: { width: 1280, height: 800 },
    locale: process.env.WORKER_LOCALE || "en-US",
    timezone: process.env.WORKER_TIMEZONE,
    proxy: process.env.WORKER_PROXY || undefined,
    geoip: process.env.WORKER_GEOIP === "true",
    humanize: process.env.WORKER_HUMANIZE !== "false",
    humanPreset: process.env.WORKER_HUMAN_PRESET === "careful" ? "careful" : undefined,
    args: [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=0.0.0.0",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(SERVICE_URLS[service].home, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch((error) => {
      console.warn(`[browser:${service}] Initial navigation failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    console.log(`[browser:${service}] Ready. Keep this process running for WORKER_BROWSER=cdp.`);
    await waitForShutdown();
  } finally {
    await context.close();
    console.log(`[browser:${service}] Closed.`);
  }
}

if (!process.argv[2] || process.argv.includes("--help")) {
  console.log(`Usage: npm run browser:serve -- <service>\n  service: ${SERVICES.join(" | ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
