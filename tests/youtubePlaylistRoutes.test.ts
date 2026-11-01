import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  playlistFindUnique: vi.fn(),
  groupCount: vi.fn(),
  sourceRuleCount: vi.fn(),
  destinationRuleCount: vi.fn(),
  createPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  storePlaylist: vi.fn(),
  removePlaylist: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    playlist: { findUnique: mocks.playlistFindUnique },
    playlistGroupMember: { count: mocks.groupCount },
    syncRule: { count: mocks.sourceRuleCount },
    syncDestination: { count: mocks.destinationRuleCount },
  },
}));
vi.mock("@/lib/services/youtube/youtubeBrowserCli", () => ({
  createYouTubePlaylistCli: mocks.createPlaylist,
  deleteYouTubePlaylistCli: mocks.deletePlaylist,
}));
vi.mock("@/lib/services/youtube/youtubeCache", () => ({
  storeCreatedYouTubePlaylist: mocks.storePlaylist,
  removeCachedYouTubePlaylist: mocks.removePlaylist,
}));

import { POST as createPlaylist } from "../app/api/youtube-browser/create/route";
import { POST as deletePlaylist } from "../app/api/youtube-browser/delete/route";

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("YouTube playlist write routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
  });

  it("creates a playlist and stores it in the app cache", async () => {
    const playlist = { id: "PL_new", name: "New playlist", trackCount: 0 };
    mocks.createPlaylist.mockResolvedValue(playlist);

    const response = await createPlaylist(post("http://localhost/api/youtube-browser/create", { name: " New playlist " }));

    expect(response.status).toBe(200);
    expect(mocks.createPlaylist).toHaveBeenCalledWith("New playlist");
    expect(mocks.storePlaylist).toHaveBeenCalledWith("user-1", playlist);
  });

  it("blocks deletion while a playlist is connected", async () => {
    mocks.playlistFindUnique.mockResolvedValue({ id: "db-playlist", userId: "user-1" });
    mocks.groupCount.mockResolvedValue(1);
    mocks.sourceRuleCount.mockResolvedValue(0);
    mocks.destinationRuleCount.mockResolvedValue(0);

    const response = await deletePlaylist(
      post("http://localhost/api/youtube-browser/delete", { playlistId: "PL_connected" }),
    );

    expect(response.status).toBe(409);
    expect(mocks.deletePlaylist).not.toHaveBeenCalled();
  });

  it("deletes an unused playlist remotely before clearing its cache", async () => {
    mocks.playlistFindUnique.mockResolvedValue({ id: "db-playlist", userId: "user-1" });
    mocks.groupCount.mockResolvedValue(0);
    mocks.sourceRuleCount.mockResolvedValue(0);
    mocks.destinationRuleCount.mockResolvedValue(0);
    mocks.deletePlaylist.mockResolvedValue({ deleted: true });

    const response = await deletePlaylist(
      post("http://localhost/api/youtube-browser/delete", { playlistId: "PL_unused" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.deletePlaylist).toHaveBeenCalledWith("PL_unused");
    expect(mocks.removePlaylist).toHaveBeenCalledWith("user-1", "PL_unused");
    expect(mocks.deletePlaylist.mock.invocationCallOrder[0]).toBeLessThan(mocks.removePlaylist.mock.invocationCallOrder[0]);
  });
});
