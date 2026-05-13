import fs from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { stateFilePath } from "@/worker/config";

type RuleForPreflight = {
  id: string;
  name: string;
  sourceService: string;
  sourcePlaylistId: string;
  destinations: Array<{
    service: string;
    playlistId: string;
    isEnabled: boolean;
  }>;
};

export type PreflightResult = {
  ok: boolean;
  reasons: string[];
};

function serviceKey(service: string): string {
  return service.toLowerCase();
}

function browserMode(): string {
  return process.env.WORKER_BROWSER || process.env.BROWSER_MODE || "state";
}

function browserAutomationEnabled(service: string): boolean {
  return process.env[`${service.toUpperCase()}_BROWSER_AUTOMATION`] === "true";
}

function cdpUrlForService(service: string): string | undefined {
  return process.env[`CDP_URL_${service.toUpperCase()}`] || process.env.CDP_URL;
}

async function hasStoredSession(service: string): Promise<boolean> {
  const key = serviceKey(service);
  if (key !== "youtube" && key !== "soundcloud" && key !== "spotify") return true;
  if (fs.existsSync(stateFilePath(key))) return true;
  const row = await prisma.workerSessionState.findUnique({ where: { service: key } }).catch(() => null);
  return Boolean(row);
}

async function checkBrowserSession(service: string): Promise<string | null> {
  if (!browserAutomationEnabled(service)) return null;
  const mode = browserMode();
  const key = serviceKey(service);

  if (mode === "state") {
    return (await hasStoredSession(key)) ? null : `${service} browser session is missing. Upload it in /admin/sessions or set ${service}_STATE_GZIP_BASE64.`;
  }

  if (mode === "cdp") {
    return cdpUrlForService(key) ? null : `${service} CDP URL is missing. Set CDP_URL_${service.toUpperCase()} or CDP_URL.`;
  }

  return null;
}

export async function preflightSyncRule(rule: RuleForPreflight): Promise<PreflightResult> {
  const reasons: string[] = [];
  const enabledDestinations = rule.destinations.filter((destination) => destination.isEnabled);

  if (enabledDestinations.length === 0) {
    reasons.push("No enabled destinations.");
  }

  const sourcePlaylist = await prisma.playlist.findUnique({
    where: {
      service_servicePlaylistId: {
        service: rule.sourceService,
        servicePlaylistId: rule.sourcePlaylistId,
      },
    },
  });
  if (!sourcePlaylist) {
    reasons.push(`Source playlist ${rule.sourceService}:${rule.sourcePlaylistId} is not cached in database.`);
  }

  for (const destination of enabledDestinations) {
    const playlist = await prisma.playlist.findUnique({
      where: {
        service_servicePlaylistId: {
          service: destination.service,
          servicePlaylistId: destination.playlistId,
        },
      },
    });
    if (!playlist) {
      reasons.push(`Destination playlist ${destination.service}:${destination.playlistId} is not cached in database.`);
    } else if (!playlist.isWritable) {
      reasons.push(`Destination playlist ${destination.service}:${playlist.name} is not writable.`);
    }
  }

  for (const service of new Set([rule.sourceService, ...enabledDestinations.map((destination) => destination.service)])) {
    const sessionIssue = await checkBrowserSession(service);
    if (sessionIssue) reasons.push(sessionIssue);
  }

  return { ok: reasons.length === 0, reasons };
}
