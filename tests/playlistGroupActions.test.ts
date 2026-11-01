import { describe, expect, test, vi } from "vitest";
import {
  createOrReusePlaylist,
  normalizeConnectPlaylistsInput,
  PlaylistGroupError,
} from "../lib/services/playlistGroupActions";

describe("normalizeConnectPlaylistsInput", () => {
  test("normalizes a valid group request", () => {
    expect(
      normalizeConnectPlaylistsInput({
        sourcePlaylistId: " source ",
        destinationPlaylistIds: ["yt", "yt", " sc "],
        name: "  My group  ",
        mode: "add_only",
        intervalMinutes: "60",
        isEnabled: false,
      }),
    ).toEqual({
      sourcePlaylistId: "source",
      destinationPlaylistIds: ["yt", "sc"],
      createDestination: null,
      name: "My group",
      mode: "ADD_ONLY",
      intervalMinutes: 60,
      isEnabled: false,
    });
  });

  test("normalizes create destination service and name", () => {
    expect(
      normalizeConnectPlaylistsInput({
        sourcePlaylistId: "sp",
        createDestination: { service: "soundcloud", name: "  Mirror  " },
      }),
    ).toMatchObject({
      sourcePlaylistId: "sp",
      createDestination: { service: "SOUNDCLOUD", name: "Mirror" },
      mode: "ADD_ONLY",
      intervalMinutes: 5,
      isEnabled: true,
    });
  });

  test("rejects invalid service, mode, interval, and source-as-destination", () => {
    expect(() =>
      normalizeConnectPlaylistsInput({
        sourcePlaylistId: "sp",
        createDestination: { service: "bandcamp", name: "Mirror" },
      }),
    ).toThrow(PlaylistGroupError);
    expect(() => normalizeConnectPlaylistsInput({ sourcePlaylistId: "sp", destinationPlaylistIds: ["yt"], mode: "bad" })).toThrow(
      PlaylistGroupError,
    );
    expect(() => normalizeConnectPlaylistsInput({ sourcePlaylistId: "sp", destinationPlaylistIds: ["yt"], intervalMinutes: 0 })).toThrow(
      PlaylistGroupError,
    );
    expect(() => normalizeConnectPlaylistsInput({ sourcePlaylistId: "sp", destinationPlaylistIds: ["sp"] })).toThrow(
      PlaylistGroupError,
    );
  });
});

describe("createOrReusePlaylist", () => {
  const existing = { id: "PL_existing", name: "Mirror Mix", trackCount: 0, isWritable: true };

  test("reuses a normalized duplicate without creating or later rolling it back", async () => {
    const adapter = { getPlaylists: vi.fn().mockResolvedValue([existing]), createPlaylist: vi.fn() };

    await expect(createOrReusePlaylist(adapter, "  mirror   MIX ")).resolves.toEqual({
      playlist: existing,
      createdRemotely: false,
    });
    expect(adapter.createPlaylist).not.toHaveBeenCalled();
  });

  test("marks a genuinely new remote playlist for rollback", async () => {
    const created = { ...existing, id: "PL_new", name: "New Mix" };
    const adapter = {
      getPlaylists: vi.fn().mockResolvedValue([existing]),
      createPlaylist: vi.fn().mockResolvedValue(created),
    };

    await expect(createOrReusePlaylist(adapter, "New Mix")).resolves.toEqual({
      playlist: created,
      createdRemotely: true,
    });
  });
});
