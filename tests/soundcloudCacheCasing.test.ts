import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { playlist: { findMany: mocks.findMany } },
}));
vi.mock("@/lib/services/soundcloud/soundCloudBrowserCli", () => ({
  listSoundCloudPlaylistTracksCli: vi.fn(),
  listSoundCloudPlaylistsCli: vi.fn(),
}));
vi.mock("@/lib/sync/snapshot", () => ({ writePlaylistSnapshot: vi.fn() }));

import { getCachedSoundCloudPlaylists } from "../lib/services/soundcloud/soundcloudCache";

describe("SoundCloud playlist cache casing", () => {
  it("queries the canonical database service key", async () => {
    mocks.findMany.mockResolvedValue([]);

    await getCachedSoundCloudPlaylists("user-1");

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", service: "SOUNDCLOUD" },
      orderBy: { name: "asc" },
    });
  });
});
