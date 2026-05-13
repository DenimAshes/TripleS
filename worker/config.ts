import path from "node:path";
import fs from "node:fs";

export type ServiceId = "youtube" | "spotify" | "soundcloud";
export type BrowserMode = "state" | "firefox" | "chrome" | "cdp";

const STATE_DIR = path.resolve(process.cwd(), "worker", "state");
const PROFILE_DIR = path.resolve(process.cwd(), "worker", "chrome-profile");

export const SERVICES: ServiceId[] = ["youtube", "spotify", "soundcloud"];
export const DEFAULT_CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

export function stateFilePath(service: ServiceId): string {
  return path.join(STATE_DIR, `${service}.json`);
}

export function debugArtifactPath(fileName: string): string {
  return path.join(STATE_DIR, fileName);
}

export function chromeProfilePath(): string {
  return process.env.CHROME_USER_DATA_DIR || PROFILE_DIR;
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
