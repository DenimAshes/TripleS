import path from "node:path";
import fs from "node:fs";

export type ServiceId = "youtube" | "spotify" | "soundcloud";
export type BrowserMode = "state" | "profile" | "chrome" | "cdp";

const STATE_DIR = path.resolve(process.cwd(), "worker", "state");
const PROFILE_DIR = path.resolve(process.cwd(), "worker", "cloak-profile");
const LEGACY_PROFILE_DIR = path.resolve(process.cwd(), "worker", "chrome-profile");

export const SERVICES: ServiceId[] = ["youtube", "spotify", "soundcloud"];
export const DEFAULT_CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

export function stateFilePath(service: ServiceId): string {
  return path.join(STATE_DIR, `${service}.json`);
}

export function debugArtifactPath(fileName: string): string {
  return path.join(STATE_DIR, fileName);
}

export function chromeProfilePath(service?: ServiceId): string {
  if (process.env.CHROME_USER_DATA_DIR) return process.env.CHROME_USER_DATA_DIR;
  const base = service ? path.join(PROFILE_DIR, service) : PROFILE_DIR;
  if (!fs.existsSync(base) && service) {
    const legacy = path.join(LEGACY_PROFILE_DIR, service);
    if (fs.existsSync(legacy)) return legacy;
  }
  return base;
}

export function ensureStateDir(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

export function parseService(value: string | undefined): ServiceId | undefined {
  return SERVICES.find((service) => service === value);
}

export const SERVICE_URLS: Record<ServiceId, { home: string; playlists?: string; loginPath?: string }> = {
  youtube: {
    home: "https://music.youtube.com/",
    playlists: "https://music.youtube.com/library/playlists",
  },
  spotify: {
    home: "https://open.spotify.com/",
    playlists: "https://open.spotify.com/collection/playlists",
    loginPath: "https://accounts.spotify.com/login",
  },
  soundcloud: {
    home: "https://soundcloud.com/",
    playlists: "https://soundcloud.com/you/library/sets",
    loginPath: "https://soundcloud.com/signin",
  },
};
