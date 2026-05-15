import fs from "node:fs";
import { binaryInfo } from "cloakbrowser";
import { prisma } from "@/lib/db/prisma";
import { listSoundCloudPlaylistsCli } from "@/lib/services/soundcloud/soundCloudBrowserCli";
import { listYouTubePlaylistsCli } from "@/lib/services/youtube/youtubeBrowserCli";
import { chromeProfilePath, stateFilePath, type ServiceId } from "@/worker/config";

type CheckStatus = "ok" | "warn" | "fail";

type CheckResult = {
  service: ServiceId | "database" | "environment";
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
};

function browserMode() {
  return process.env.WORKER_BROWSER || process.env.BROWSER_MODE || "state";
}

function checkTimeoutMs(): number {
  const value = Number(process.env.WORKER_CHECK_TIMEOUT_MS ?? 90_000);
  return Number.isFinite(value) && value > 0 ? value : 90_000;
}

function classifyError(error: unknown): { status: CheckStatus; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/captcha|blocked the write request|anti-abuse/i.test(message)) {
    return {
      status: "warn",
      message: "Manual service check is required before write actions will work.",
    };
  }
  if (/not logged in|not signed in|No saved .* browser session/i.test(message)) {
    return {
      status: "fail",
      message: "Browser session is missing or logged out.",
    };
  }
  return { status: "fail", message };
}

function sessionDetails(service: ServiceId) {
  const statePath = stateFilePath(service);
  const profilePath = chromeProfilePath(service);
  return {
    browserMode: browserMode(),
    headless: process.env.HEADLESS ?? "true",
    statePath,
    stateExists: fs.existsSync(statePath),
    profilePath,
    profileExists: fs.existsSync(profilePath),
  };
}

async function checkEnvironment(): Promise<CheckResult> {
  const mode = browserMode();
  const allowedModes = new Set(["state", "profile", "cdp", "chrome"]);
  if (!allowedModes.has(mode)) {
    return {
      service: "environment",
      status: "fail",
      message: `Unsupported WORKER_BROWSER mode: ${mode}`,
      details: { allowedModes: Array.from(allowedModes) },
    };
  }
  return {
    service: "environment",
    status: "ok",
    message: "Worker environment is readable.",
    details: {
      browserMode: mode,
      headless: process.env.HEADLESS ?? "true",
      youtubeBrowserAutomation: process.env.YOUTUBE_BROWSER_AUTOMATION,
      soundcloudBrowserAutomation: process.env.SOUNDCLOUD_BROWSER_AUTOMATION,
    },
  };
}

async function checkDatabase(): Promise<CheckResult> {
  try {
    const [users, playlists, syncRules, dueRules] = await Promise.all([
      prisma.user.count(),
      prisma.playlist.count(),
      prisma.syncRule.count(),
      prisma.syncRule.count({
        where: {
          isEnabled: true,
          OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
        },
      }),
    ]);
    return {
      service: "database",
      status: "ok",
      message: "Database is reachable.",
      details: { users, playlists, syncRules, dueRules },
    };
  } catch (error) {
    const classified = classifyError(error);
    return {
      service: "database",
      status: classified.status,
      message: classified.message,
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function checkYouTube(): Promise<CheckResult> {
  try {
    const playlists = await listYouTubePlaylistsCli();
    return {
      service: "youtube",
      status: playlists.length > 0 ? "ok" : "warn",
      message: playlists.length > 0 ? "YouTube Music session can read playlists." : "YouTube Music session opened, but no playlists were found.",
      details: {
        ...sessionDetails("youtube"),
        playlistCount: playlists.length,
        samplePlaylists: playlists.slice(0, 5).map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          trackCount: playlist.trackCount,
        })),
        writeProbe: "not_run_non_destructive_check",
      },
    };
  } catch (error) {
    const classified = classifyError(error);
    return {
      service: "youtube",
      status: classified.status,
      message: classified.message,
      details: {
        ...sessionDetails("youtube"),
        error: error instanceof Error ? error.message : String(error),
        recovery: "Run: npm run chrome -- youtube && npm run login -- youtube cdp",
      },
    };
  }
}

async function checkSoundCloud(): Promise<CheckResult> {
  try {
    const playlists = await listSoundCloudPlaylistsCli();
    const writableCount = playlists.filter((playlist) => playlist.isWritable).length;
    return {
      service: "soundcloud",
      status: playlists.length > 0 ? "ok" : "warn",
      message: playlists.length > 0 ? "SoundCloud session can read playlists." : "SoundCloud session opened, but no playlists were found.",
      details: {
        ...sessionDetails("soundcloud"),
        playlistCount: playlists.length,
        writableCount,
        samplePlaylists: playlists.slice(0, 5).map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          trackCount: playlist.trackCount,
          isWritable: playlist.isWritable,
        })),
        writeProbe: "not_run_non_destructive_check",
      },
    };
  } catch (error) {
    const classified = classifyError(error);
    return {
      service: "soundcloud",
      status: classified.status,
      message: classified.message,
      details: {
        ...sessionDetails("soundcloud"),
        error: error instanceof Error ? error.message : String(error),
        recovery: "Run: npm run chrome -- soundcloud && npm run login -- soundcloud cdp",
      },
    };
  }
}

function printResult(result: CheckResult) {
  const marker = result.status === "ok" ? "OK" : result.status === "warn" ? "WARN" : "FAIL";
  console.log(`[${marker}] ${result.service}: ${result.message}`);
  if (result.details) {
    console.log(JSON.stringify(result.details, null, 2));
  }
}

function jsonOutput(): boolean {
  return process.argv.includes("--json");
}

function liveOutput(): boolean {
  return process.argv.includes("--live") || process.env.WORKER_CHECK_LIVE === "true";
}

function selectedService(): ServiceId | null {
  const arg = process.argv.find((value) => value.startsWith("--service="));
  if (!arg) return null;
  const raw = arg.slice("--service=".length).toLowerCase();
  if (raw === "youtube" || raw === "soundcloud" || raw === "library") return raw as ServiceId;
  if (raw === "yt") return "youtube";
  if (raw === "sc") return "soundcloud";
  throw new Error(`Unknown --service=${raw}. Use youtube|soundcloud.`);
}

function alignCliTimeoutsForLiveCheck(): void {
  const timeout = String(checkTimeoutMs());
  if (process.env.WORKER_CHECK_TIMEOUT_MS) {
    process.env.YOUTUBE_CLI_TIMEOUT_MS = timeout;
    process.env.SOUNDCLOUD_CLI_TIMEOUT_MS = timeout;
    return;
  }
  process.env.YOUTUBE_CLI_TIMEOUT_MS ||= timeout;
  process.env.SOUNDCLOUD_CLI_TIMEOUT_MS ||= timeout;
}

async function checkCloakBinary(): Promise<CheckResult> {
  try {
    const info = binaryInfo();
    return {
      service: "environment",
      status: info.installed ? "ok" : "warn",
      message: info.installed
        ? `CloakBrowser binary installed (${info.version}).`
        : "CloakBrowser binary not yet downloaded. Run: npm run cloak:install",
      details: {
        version: info.version,
        platform: info.platform,
        binaryPath: info.binaryPath,
        installed: info.installed,
        override: process.env.CLOAKBROWSER_BINARY_PATH ?? null,
      },
    };
  } catch (error) {
    return {
      service: "environment",
      status: "warn",
      message: "Could not read CloakBrowser binary info.",
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function main() {
  const environment = await checkEnvironment();
  const cloak = await checkCloakBinary();
  const database = await checkDatabase();
  const checks = [environment, cloak, database];
  if (liveOutput()) {
    alignCliTimeoutsForLiveCheck();
  }

  const cloakInstalled = cloak.details?.installed === true;
  const canSkipCloak = browserMode() === "cdp";
  const allowDownload = process.env.WORKER_CHECK_INSTALL_BINARY === "true";

  const onlyService = selectedService();

  if (!liveOutput()) {
    if (onlyService !== "soundcloud") {
      checks.push({
        service: "youtube",
        status: "warn",
        message: "Skipped live browser check. Run npm run worker:check:live to open the service.",
        details: sessionDetails("youtube"),
      });
    }
    if (onlyService !== "youtube") {
      checks.push({
        service: "soundcloud",
        status: "warn",
        message: "Skipped live browser check. Run npm run worker:check:live to open the service.",
        details: sessionDetails("soundcloud"),
      });
    }
  } else if (!cloakInstalled && !canSkipCloak && !allowDownload) {
    const details = {
      reason: "CloakBrowser binary is missing, and worker:check does not auto-download it by default.",
      recovery: "Run npm run cloak:install, or set WORKER_CHECK_INSTALL_BINARY=true for this check.",
      ...sessionDetails("youtube"),
    };
    if (onlyService !== "soundcloud") {
      checks.push({
        service: "youtube",
        status: "warn",
        message: "Skipped browser check because CloakBrowser binary is not installed.",
        details,
      });
    }
    if (onlyService !== "youtube") {
      checks.push({
        service: "soundcloud",
        status: "warn",
        message: "Skipped browser check because CloakBrowser binary is not installed.",
        details: { ...details, ...sessionDetails("soundcloud") },
      });
    }
  } else {
    if (onlyService !== "soundcloud") checks.push(await checkYouTube());
    if (onlyService !== "youtube") checks.push(await checkSoundCloud());
  }

  if (jsonOutput()) {
    const overall: CheckStatus = checks.some((c) => c.status === "fail")
      ? "fail"
      : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";
    console.log(JSON.stringify({ status: overall, timestamp: new Date().toISOString(), checks }, null, 2));
  } else {
    for (const check of checks) printResult(check);
  }

  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
