import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  playlistFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    playlist: {
      findMany: mocks.playlistFindMany,
    },
  },
}));

import { SyncRuleRequestError, validateSyncRuleInput } from "../lib/services/syncRuleRequest";

describe("validateSyncRuleInput", () => {
  beforeEach(() => {
    mocks.playlistFindMany.mockReset();
  });

  test("normalizes and validates a sync rule request", async () => {
    mocks.playlistFindMany.mockResolvedValue([
      {
        service: "SPOTIFY",
        servicePlaylistId: "sp-1",
        isWritable: true,
        name: "Spotify source",
      },
      {
        service: "YOUTUBE",
        servicePlaylistId: "yt-1",
        isWritable: true,
        name: "YouTube target",
      },
    ]);

    await expect(
      validateSyncRuleInput("user-1", {
        name: "  Bridge  ",
        sourceService: "spotify",
        sourcePlaylistId: "sp-1",
        mode: "add_only",
        intervalMinutes: 60,
        isEnabled: true,
        destinations: [{ service: "youtube", playlistId: "yt-1" }],
      }),
    ).resolves.toEqual({
      name: "Bridge",
      sourceService: "SPOTIFY",
      sourcePlaylistId: "sp-1",
      mode: "ADD_ONLY",
      intervalMinutes: 60,
      isEnabled: true,
      destinations: [{ service: "YOUTUBE", playlistId: "yt-1" }],
    });
  });

  test("rejects source playlist as its own destination", async () => {
    await expect(
      validateSyncRuleInput("user-1", {
        sourceService: "SPOTIFY",
        sourcePlaylistId: "sp-1",
        destinations: [{ service: "SPOTIFY", playlistId: "sp-1" }],
      }),
    ).rejects.toMatchObject({ status: 400 } satisfies Partial<SyncRuleRequestError>);
    expect(mocks.playlistFindMany).not.toHaveBeenCalled();
  });

  test("rejects zero-minute polling intervals", async () => {
    await expect(
      validateSyncRuleInput("user-1", {
        sourceService: "SPOTIFY",
        sourcePlaylistId: "sp-1",
        intervalMinutes: 0,
        destinations: [{ service: "YOUTUBE", playlistId: "yt-1" }],
      }),
    ).rejects.toMatchObject({ status: 400 } satisfies Partial<SyncRuleRequestError>);
    expect(mocks.playlistFindMany).not.toHaveBeenCalled();
  });

  test("rejects non-writable destinations", async () => {
    mocks.playlistFindMany.mockResolvedValue([
      {
        service: "SPOTIFY",
        servicePlaylistId: "sp-1",
        isWritable: true,
        name: "Spotify source",
      },
      {
        service: "SOUNDCLOUD",
        servicePlaylistId: "sc-1",
        isWritable: false,
        name: "SoundCloud likes",
      },
    ]);

    await expect(
      validateSyncRuleInput("user-1", {
        sourceService: "SPOTIFY",
        sourcePlaylistId: "sp-1",
        destinations: [{ service: "SOUNDCLOUD", playlistId: "sc-1" }],
      }),
    ).rejects.toMatchObject({ status: 409 } satisfies Partial<SyncRuleRequestError>);
  });
});
