import type { ServiceKey } from "@/lib/sync/syncTypes";
import type { MusicServiceAdapter } from "./MusicServiceAdapter";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("triples:adapter");
import { SpotifyAdapter } from "./spotify/SpotifyAdapter";
import { SpotifyMockAdapter } from "./spotify/SpotifyMockAdapter";
import { YouTubeBrowserAdapter } from "./youtube/YouTubeBrowserAdapter";
import { YouTubeMockAdapter } from "./youtube/YouTubeMockAdapter";
import { SoundCloudAdapter } from "./soundcloud/SoundCloudAdapter";
import { SoundCloudBrowserAdapter } from "./soundcloud/SoundCloudBrowserAdapter";
import { SoundCloudMockAdapter } from "./soundcloud/SoundCloudMockAdapter";

export function serviceKey(service: string): ServiceKey {
  return service.toLowerCase() as ServiceKey;
}

export function serviceEnum(service: ServiceKey): string {
  return service.toUpperCase();
}

export function getAdapter(service: string, userId?: string): MusicServiceAdapter {
  const key = typeof service === "string" && service === service.toUpperCase() ? service.toLowerCase() : service;
  if (key === "spotify") {
    // SpotifyAdapter handles both OAuth (when SPOTIFY_CLIENT_ID is set) and
    // the sp_dc web-cookie path (no OAuth credentials needed). Falling back
    // to the mock when SPOTIFY_CLIENT_ID is missing — like we used to —
    // silently dropped users who set up the cookie connector but never
    // configured an OAuth app, returning empty playlists no matter what.
    // The mock is only useful when neither userId nor any account data is
    // available, e.g. dry-run scripts that pass no userId.
    if (!userId && !process.env.SPOTIFY_CLIENT_ID) {
      log.debug("spotify adapter resolved", { mode: "mock", reason: "no userId and no OAuth" });
      return new SpotifyMockAdapter();
    }
    log.debug("spotify adapter resolved", { mode: "live", oauth: Boolean(process.env.SPOTIFY_CLIENT_ID) });
    return new SpotifyAdapter(userId);
  }
  if (key === "youtube") {
    if (process.env.YOUTUBE_BROWSER_AUTOMATION === "true") {
      log.debug("youtube adapter resolved", { mode: "browser" });
      return new YouTubeBrowserAdapter();
    }
    log.debug("youtube adapter resolved", { mode: "mock" });
    return new YouTubeMockAdapter();
  }
  if (key === "soundcloud") {
    if (process.env.SOUNDCLOUD_BROWSER_AUTOMATION === "true") {
      log.debug("soundcloud adapter resolved", { mode: "browser" });
      return new SoundCloudBrowserAdapter();
    }
    if (!process.env.SOUNDCLOUD_CLIENT_ID) {
      log.debug("soundcloud adapter resolved", { mode: "mock" });
      return new SoundCloudMockAdapter();
    }
  }
  return new SoundCloudAdapter();
}
