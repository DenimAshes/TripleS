import type { ServiceKey } from "@/lib/sync/syncTypes";
import type { MusicServiceAdapter } from "./MusicServiceAdapter";
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
      console.log("[spotify] Running in MOCK mode");
      return new SpotifyMockAdapter();
    }
    return new SpotifyAdapter(userId);
  }
  if (key === "youtube") {
    if (process.env.YOUTUBE_BROWSER_AUTOMATION === "true") {
      console.log("[youtube] Running in browser automation mode");
      return new YouTubeBrowserAdapter();
    }
    console.log("[youtube] Running in MOCK mode");
    return new YouTubeMockAdapter();
  }
  if (key === "soundcloud") {
    if (process.env.SOUNDCLOUD_BROWSER_AUTOMATION === "true") {
      console.log("[soundcloud] Running in browser automation mode");
      return new SoundCloudBrowserAdapter();
    }
    if (!process.env.SOUNDCLOUD_CLIENT_ID) {
      console.log("[soundcloud] Running in MOCK mode");
      return new SoundCloudMockAdapter();
    }
  }
  return new SoundCloudAdapter();
}
