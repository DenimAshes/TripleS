import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  playlistFindUnique: vi.fn(),
  playlistFindMany: vi.fn(),
  playlistUpsert: vi.fn(),
  playlistDelete: vi.fn(),
  memberDeleteMany: vi.fn(),
  stateDeleteMany: vi.fn(),
  transaction: vi.fn(),
  getAdapter: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    playlist: {
      findUnique: mocks.playlistFindUnique,
      findMany: mocks.playlistFindMany,
      upsert: mocks.playlistUpsert,
      delete: mocks.playlistDelete,
    },
    playlistGroupMember: { deleteMany: mocks.memberDeleteMany },
    playlistTrackState: { deleteMany: mocks.stateDeleteMany },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/services/adapterFactory", () => ({
  getAdapter: mocks.getAdapter,
  serviceKey: (service: string) => service.toLowerCase(),
  serviceEnum: (service: string) => service.toUpperCase(),
}));

import { connectPlaylistGroup } from "../lib/services/playlistGroupActions";

function playlist(id: string, name: string) {
  return { id, name, trackCount: 0, isWritable: true };
}

describe("playlist group multi-create rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.playlistFindUnique.mockResolvedValue({
      id: "source-db",
      userId: "user-1",
      service: "SPOTIFY",
      name: "Source",
    });
    mocks.playlistDelete.mockResolvedValue({});
    mocks.memberDeleteMany.mockResolvedValue({ count: 0 });
    mocks.stateDeleteMany.mockResolvedValue({ count: 0 });
    mocks.transaction.mockResolvedValue([]);
  });

  it("creates sequentially and rolls new playlists back in reverse order", async () => {
    const order: string[] = [];
    const youtube = {
      getPlaylists: vi.fn().mockResolvedValue([]),
      createPlaylist: vi.fn(async () => {
        order.push("create-youtube");
        return playlist("yt-new", "YouTube mirror");
      }),
      deletePlaylist: vi.fn(async () => {
        order.push("delete-youtube");
        return { deleted: true };
      }),
    };
    const soundcloud = {
      getPlaylists: vi.fn().mockResolvedValue([]),
      createPlaylist: vi.fn(async () => {
        order.push("create-soundcloud");
        return playlist("sc-new", "SoundCloud mirror");
      }),
      deletePlaylist: vi.fn(async () => {
        order.push("delete-soundcloud");
        return { deleted: true };
      }),
    };
    mocks.getAdapter.mockImplementation((service: string) => (service === "YOUTUBE" ? youtube : soundcloud));
    mocks.playlistUpsert
      .mockResolvedValueOnce({ id: "yt-db" })
      .mockResolvedValueOnce({ id: "sc-db" });
    mocks.playlistFindMany.mockRejectedValue(new Error("DB unavailable"));

    await expect(
      connectPlaylistGroup("user-1", {
        sourcePlaylistId: "source-db",
        createDestinations: [
          { service: "YOUTUBE", name: "YouTube mirror" },
          { service: "SOUNDCLOUD", name: "SoundCloud mirror" },
        ],
      }),
    ).rejects.toThrow("DB unavailable");

    expect(order).toEqual(["create-youtube", "create-soundcloud", "delete-soundcloud", "delete-youtube"]);
  });

  it("never deletes a same-name playlist that already existed", async () => {
    const existing = playlist("yt-existing", "YouTube mirror");
    const youtube = {
      getPlaylists: vi.fn().mockResolvedValue([existing]),
      createPlaylist: vi.fn(),
      deletePlaylist: vi.fn(),
    };
    const soundcloud = {
      getPlaylists: vi.fn().mockResolvedValue([]),
      createPlaylist: vi.fn().mockRejectedValue(new Error("SoundCloud unavailable")),
      deletePlaylist: vi.fn(),
    };
    mocks.getAdapter.mockImplementation((service: string) => (service === "YOUTUBE" ? youtube : soundcloud));
    mocks.playlistUpsert.mockResolvedValue({ id: "yt-db" });

    await expect(
      connectPlaylistGroup("user-1", {
        sourcePlaylistId: "source-db",
        createDestinations: [
          { service: "YOUTUBE", name: " youtube   MIRROR " },
          { service: "SOUNDCLOUD", name: "SoundCloud mirror" },
        ],
      }),
    ).rejects.toThrow("SoundCloud unavailable");

    expect(youtube.createPlaylist).not.toHaveBeenCalled();
    expect(youtube.deletePlaylist).not.toHaveBeenCalled();
  });
});
