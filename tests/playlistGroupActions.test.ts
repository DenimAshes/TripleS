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
      createDestinations: [],
      name: "My group",
      mode: "ADD_ONLY",
      intervalMinutes: 60,
      isEnabled: false,
    });
  });

  test("keeps the legacy single-create shape working", () => {
    expect(
      normalizeConnectPlaylistsInput({
        sourcePlaylistId: "sp",
        createDestination: { service: "soundcloud", name: "  Mirror  " },
      }),
    ).toMatchObject({
      sourcePlaylistId: "sp",
      createDestinations: [{ service: "SOUNDCLOUD", name: "Mirror" }],
      mode: "ADD_ONLY",
      intervalMinutes: 5,
      isEnabled: true,
    });
  });

  test("normalizes one or two new destination playlists", () => {
    expect(
      normalizeConnectPlaylistsInput({
        sourcePlaylistId: "sp",
        createDestinations: [
          { service: "youtube", name: "  YouTube mirror  " },
          { service: "soundcloud", name: "SoundCloud mirror" },
        ],
      }),
    ).toMatchObject({
      createDestinations: [
        { service: "YOUTUBE", name: "YouTube mirror" },
        { service: "SOUNDCLOUD", name: "SoundCloud mirror" },
      ],
    });
    expect(
      normalizeConnectPlaylistsInput({
        sourcePlaylistId: "sp",
        createDestinations: [{ service: "youtube", name: "Only one" }],
      }).createDestinations,
    ).toEqual([{ service: "YOUTUBE", name: "Only one" }]);
  });

  test("allows one existing destination alongside one new destination", () => {
    expect(
      normalizeConnectPlaylistsInput({
        sourcePlaylistId: "sp",
        destinationPlaylistIds: ["existing-soundcloud"],
        createDestinations: [{ service: "youtube", name: "YouTube mirror" }],
      }),
    ).toMatchObject({
      destinationPlaylistIds: ["existing-soundcloud"],
      createDestinations: [{ service: "YOUTUBE", name: "YouTube mirror" }],
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
    expect(() => normalizeConnectPlaylistsInput({ sourcePlaylistId: "sp", createDestinations: "youtube" })).toThrow(
      PlaylistGroupError,
    );
    expect(() =>
      normalizeConnectPlaylistsInput({
        sourcePlaylistId: "sp",
        createDestinations: [
          { service: "youtube", name: "One" },
          { service: "youtube", name: "Two" },
        ],
      }),
    ).toThrow(PlaylistGroupError);
    expect(() =>
      normalizeConnectPlaylistsInput({
        sourcePlaylistId: "sp",
        destinationPlaylistIds: ["existing"],
        createDestinations: [
          { service: "youtube", name: "One" },
          { service: "soundcloud", name: "Two" },
        ],
      }),
    ).toThrow(PlaylistGroupError);
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
