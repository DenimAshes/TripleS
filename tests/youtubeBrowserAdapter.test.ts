import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/services/runnerInvoker", () => ({
  invokeYouTubeAddTrack: vi.fn(),
  invokeYouTubeCreatePlaylist: mocks.create,
  invokeYouTubeDeletePlaylist: mocks.delete,
  invokeYouTubeListPlaylistTracks: vi.fn(),
  invokeYouTubeListPlaylists: mocks.list,
  invokeYouTubeRemoveTrack: vi.fn(),
  invokeYouTubeSearchTracks: vi.fn(),
}));

import { YouTubeBrowserAdapter } from "../lib/services/youtube/YouTubeBrowserAdapter";

const playlist = { id: "PL_test", name: "Mirror Mix", trackCount: 0, isWritable: true };

describe("YouTubeBrowserAdapter playlist writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates and deletes playlists through the browser runner", async () => {
    mocks.create.mockResolvedValue(playlist);
    mocks.delete.mockResolvedValue({ deleted: true });
    const adapter = new YouTubeBrowserAdapter();

    await expect(adapter.createPlaylist("Mirror Mix", "TripleS")).resolves.toEqual(playlist);
    expect(mocks.create).toHaveBeenCalledWith("Mirror Mix", "TripleS");
    await expect(adapter.deletePlaylist("PL_test")).resolves.toEqual({ deleted: true });
  });

  it("returns the existing playlist when create succeeded before the runner failed", async () => {
    mocks.create.mockRejectedValue(new Error("runner timed out"));
    mocks.list.mockResolvedValue([playlist]);

    await expect(new YouTubeBrowserAdapter().createPlaylist("  mirror   MIX ")).resolves.toEqual(playlist);
  });
});
