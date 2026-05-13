import { spawn } from "node:child_process";
import fs from "node:fs";
import { ensureBinary, getDefaultStealthArgs } from "cloakbrowser";
import { DEFAULT_CDP_URL, chromeProfilePath, parseService, SERVICE_URLS, type ServiceId } from "./config";

function cdpPort(): string {
  const url = new URL(DEFAULT_CDP_URL);
  return url.port || "9222";
}

async function main() {
  const service = parseService(process.argv[2]) || "youtube";
  const profile = chromeProfilePath(service);
  fs.mkdirSync(profile, { recursive: true });

  const binary = process.env.CLOAKBROWSER_BINARY_PATH || (await ensureBinary());
  const stealthArgs = getDefaultStealthArgs();
  const args = [
    ...stealthArgs,
    `--remote-debugging-port=${cdpPort()}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    SERVICE_URLS[service].home,
  ];

  console.log(`[chrome] Starting cloakbrowser binary: ${binary}`);
  console.log(`[chrome] Profile: ${profile}`);
  console.log(`[chrome] CDP: ${DEFAULT_CDP_URL}`);
  console.log(`[chrome] Opened: ${serviceLabel(service)}`);
  console.log(`[chrome] Keep this window open while running npm run login -- ${service} cdp`);

  const child = spawn(binary, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

function serviceLabel(service: ServiceId): string {
  if (service === "youtube") return "YouTube Music";
  if (service === "soundcloud") return "SoundCloud";
  return "Spotify";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
