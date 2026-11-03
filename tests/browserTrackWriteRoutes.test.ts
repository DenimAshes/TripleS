import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  youtubeAdd: vi.fn(),
  youtubeRemove: vi.fn(),
  soundcloudAdd: vi.fn(),
  soundcloudRemove: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: { playlist: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/services/youtube/youtubeBrowserCli", () => ({
  addFirstSearchResultToPlaylistCli: mocks.youtubeAdd,
  removeTrackFromPlaylistCli: mocks.youtubeRemove,
}));
vi.mock("@/lib/services/youtube/youtubeCache", () => ({ invalidateYouTubePlaylistTracks: vi.fn() }));
vi.mock("@/lib/services/soundcloud/soundCloudBrowserCli", () => ({
  addSoundCloudTrackToPlaylistCli: mocks.soundcloudAdd,
  removeSoundCloudTrackFromPlaylistCli: mocks.soundcloudRemove,
}));
vi.mock("@/lib/services/soundcloud/soundcloudCache", () => ({ invalidateSoundCloudPlaylistTracks: vi.fn() }));

import { POST as addYouTube } from "@/app/api/youtube-browser/add/route";
import { POST as removeSoundCloud } from "@/app/api/soundcloud-browser/remove/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("browser track write ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null);
  });

  it("does not add to a foreign YouTube playlist", async () => {
    const response = await addYouTube(jsonRequest("http://localhost/api/youtube-browser/add", {
      playlistId: "foreign-playlist",
      query: "Artist Song",
    }));

    expect(response.status).toBe(404);
    expect(mocks.youtubeAdd).not.toHaveBeenCalled();
  });

  it("does not remove from a foreign SoundCloud playlist", async () => {
    const response = await removeSoundCloud(jsonRequest("http://localhost/api/soundcloud-browser/remove", {
      playlistId: "foreign/sets/playlist",
      trackId: "artist/track",
    }));

    expect(response.status).toBe(404);
    expect(mocks.soundcloudRemove).not.toHaveBeenCalled();
  });
});
