import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CDP_URL, chromeProfilePath, parseService, SERVICE_URLS, type ServiceId } from "./config";

function findChromeExecutable(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean) as string[];

  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error("Chrome executable not found. Set CHROME_PATH to chrome.exe / google-chrome.");
  }
  return executable;
}

function cdpPort(): string {
  const url = new URL(DEFAULT_CDP_URL);
  return url.port || "9222";
}

async function main() {
  const service = parseService(process.argv[2]) || "youtube";
  const profile = chromeProfilePath(service);
  fs.mkdirSync(profile, { recursive: true });

  const chrome = findChromeExecutable();
  const args = [
    `--remote-debugging-port=${cdpPort()}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    SERVICE_URLS[service].home,
  ];

  console.log(`[chrome] Starting ${chrome}`);
  console.log(`[chrome] Profile: ${profile}`);
  console.log(`[chrome] CDP: ${DEFAULT_CDP_URL}`);
  console.log(`[chrome] Opened: ${serviceLabel(service)}`);
  console.log(`[chrome] Keep this window open while running npm run login -- ${service} cdp`);

  const child = spawn(chrome, args, {
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
