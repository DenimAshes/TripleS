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
    if (!process.env.SPOTIFY_CLIENT_ID) {
      log.debug("spotify adapter resolved", { mode: "mock" });
      return new SpotifyMockAdapter();
    }
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
