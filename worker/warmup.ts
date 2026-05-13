import fs from "node:fs";
import { launchPersistentContext } from "cloakbrowser";
import { chromeProfilePath, parseService, SERVICES, SERVICE_URLS } from "./config";
import { sleep } from "./sleep";

async function main() {
  const service = parseService(process.argv[2]);
  if (!service) {
    console.error(`Usage: npm run warmup -- <service>\n  service: ${SERVICES.join(" | ")}`);
    process.exit(1);
  }

  const profile = chromeProfilePath(service);
  fs.mkdirSync(profile, { recursive: true });

  console.log(`[warmup:${service}] Profile: ${profile}`);
  console.log(`[warmup:${service}] Visiting ${SERVICE_URLS[service].home} with --disable-http2 to seed cookies.`);

  const context = await launchPersistentContext({
    userDataDir: profile,
    headless: process.env.HEADLESS === "false" ? false : true,
    args: ["--disable-http2"],
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    proxy: process.env.WORKER_PROXY || undefined,
    geoip: process.env.WORKER_GEOIP === "true",
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(SERVICE_URLS[service].home, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(8000);
    console.log(`[warmup:${service}] Done. Subsequent runs can drop --disable-http2.`);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
