import fs from "node:fs";
import { launchPersistentContext } from "cloakbrowser";
import { chromeProfilePath, parseService, SERVICES, SERVICE_URLS, stateFilePath } from "./config";

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
    console.error(`Usage: npm run captcha:solve -- <service>\n  service: ${SERVICES.join(" | ")}`);
    console.error("Opens the service in a headed stealth browser using your saved profile,");
    console.error("lets you solve any pending captcha by hand, then re-exports storage state.");
    process.exit(1);
  }

  const profile = chromeProfilePath(service);
  fs.mkdirSync(profile, { recursive: true });
  const statePath = stateFilePath(service);

  console.log(`[captcha:${service}] Profile: ${profile}`);
  console.log(`[captcha:${service}] Opening ${SERVICE_URLS[service].home} in headed mode.`);
  console.log(`[captcha:${service}] Solve any captcha / verification challenge in the window.`);
  console.log(`[captcha:${service}] When done, return here and press Enter to save state.\n`);

  const context = await launchPersistentContext({
    userDataDir: profile,
    headless: false,
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    proxy: process.env.WORKER_PROXY || undefined,
    geoip: process.env.WORKER_GEOIP === "true",
    humanize: true,
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(SERVICE_URLS[service].home, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForEnter();
    await context.storageState({ path: statePath });
    console.log(`[captcha:${service}] State saved to ${statePath}.`);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
