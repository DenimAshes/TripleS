import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  count: vi.fn(),
  youtubePlaylists: vi.fn(),
  youtubeTracks: vi.fn(),
  soundcloudTracks: vi.fn(),
  writeSnapshot: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    playlist: { findUnique: mocks.findUnique, findMany: mocks.findMany, upsert: mocks.upsert },
    playlistTrackState: { count: mocks.count },
  },
}));
vi.mock("@/lib/services/youtube/youtubeBrowserCli", () => ({
  listYouTubePlaylistTracksCli: mocks.youtubeTracks,
  listYouTubePlaylistsCli: mocks.youtubePlaylists,
}));
vi.mock("@/lib/services/soundcloud/soundCloudBrowserCli", () => ({
  listSoundCloudPlaylistTracksCli: mocks.soundcloudTracks,
}));
vi.mock("@/lib/sync/snapshot", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sync/snapshot")>(),
  writePlaylistSnapshot: mocks.writeSnapshot,
}));

import { refreshYouTubePlaylistTracks, refreshYouTubePlaylists } from "@/lib/services/youtube/youtubeCache";
import { refreshSoundCloudPlaylistTracks } from "@/lib/services/soundcloud/soundcloudCache";

describe("browser cache completeness guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ id: "row-1", userId: "user-1", trackCount: 100 });
    mocks.count.mockResolvedValue(100);
  });

  it("keeps the prior YouTube snapshot after an incomplete read", async () => {
    mocks.youtubeTracks.mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({
      title: `Track ${index}`,
      artists: [],
      sourceService: "youtube",
      sourceTrackId: String(index),
    })));

    await expect(refreshYouTubePlaylistTracks("user-1", "playlist-1"))
      .rejects.toThrow("incomplete (20/100)");
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it("checks SoundCloud ownership before invoking the provider runner", async () => {
    mocks.findUnique.mockResolvedValue({ id: "row-1", userId: "other-user", trackCount: 100 });

    await expect(refreshSoundCloudPlaylistTracks("user-1", "playlist-1"))
      .rejects.toThrow("Playlist not found for this user");
    expect(mocks.soundcloudTracks).not.toHaveBeenCalled();
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it("does not transfer a cached YouTube playlist to another app user", async () => {
    mocks.youtubePlaylists.mockResolvedValue([{ id: "playlist-1", name: "List", trackCount: 1 }]);
    mocks.findMany.mockResolvedValue([{ servicePlaylistId: "playlist-1", userId: "other-user" }]);

    await expect(refreshYouTubePlaylists("user-1"))
      .rejects.toThrow("already owned by another app user");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
