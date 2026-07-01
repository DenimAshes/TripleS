import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  playlistTrackStateFindMany: vi.fn(),
  syncRuleUpdateMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    manualMatchCandidate: {
      updateMany: mocks.updateMany,
    },
    playlistTrackState: {
      findMany: mocks.playlistTrackStateFindMany,
    },
    syncRule: {
      updateMany: mocks.syncRuleUpdateMany,
    },
  },
}));

import {
  closeCompetingManualCandidates,
  scheduleManualMatchFollowupSync,
  scheduleManualMatchFollowupSyncs,
} from "../lib/services/manualMatchResolution";

describe("manual match resolution", () => {
  beforeEach(() => {
    mocks.updateMany.mockReset();
    mocks.playlistTrackStateFindMany.mockReset();
    mocks.syncRuleUpdateMany.mockReset();
    mocks.updateMany.mockResolvedValue({ count: 2 });
    mocks.syncRuleUpdateMany.mockResolvedValue({ count: 1 });
  });

  test("rejects other pending candidates for the same source and target service", async () => {
    const result = await closeCompetingManualCandidates({
      userId: "user-1",
      sourceServiceTrackId: "source-track",
      targetService: "YOUTUBE",
      keepId: "candidate-1",
    });

    expect(result).toEqual({ count: 2 });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        sourceServiceTrackId: "source-track",
        targetService: "YOUTUBE",
        id: { not: "candidate-1" },
        status: "PENDING",
      },
      data: { status: "REJECTED" },
    });
  });

  test("schedules the enabled source rule after resolving a candidate", async () => {
    mocks.playlistTrackStateFindMany.mockResolvedValue([
      {
        playlist: {
          service: "SPOTIFY",
          servicePlaylistId: "sp-1",
        },
      },
    ]);

    const result = await scheduleManualMatchFollowupSync({
      userId: "user-1",
      sourceServiceTrackId: "source-track",
    });

    expect(result).toEqual({ count: 1 });
    expect(mocks.playlistTrackStateFindMany).toHaveBeenCalledWith({
      where: {
        serviceTrackId: { in: ["source-track"] },
        removedAt: null,
        playlist: { userId: "user-1" },
      },
      include: {
        playlist: {
          select: {
            service: true,
            servicePlaylistId: true,
          },
        },
      },
    });
    expect(mocks.syncRuleUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        isEnabled: true,
        OR: [{ sourceService: "SPOTIFY", sourcePlaylistId: "sp-1" }],
      },
      data: { nextRunAt: null },
    });
  });

  test("does not filter follow-up scheduling by sync direction", async () => {
    mocks.playlistTrackStateFindMany.mockResolvedValue([
      {
        playlist: {
          service: "SPOTIFY",
          servicePlaylistId: "sp-one-way",
        },
      },
    ]);

    await scheduleManualMatchFollowupSync({
      userId: "user-1",
      sourceServiceTrackId: "source-track",
    });

    expect(mocks.syncRuleUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        isEnabled: true,
        OR: [{ sourceService: "SPOTIFY", sourcePlaylistId: "sp-one-way" }],
      },
      data: { nextRunAt: null },
    });
  });

  test("schedules every active source playlist that contains the resolved source track", async () => {
    mocks.playlistTrackStateFindMany.mockResolvedValue([
      { playlist: { service: "SPOTIFY", servicePlaylistId: "sp-1" } },
      { playlist: { service: "YOUTUBE", servicePlaylistId: "yt-1" } },
    ]);
    mocks.syncRuleUpdateMany.mockResolvedValue({ count: 2 });

    const result = await scheduleManualMatchFollowupSync({
      userId: "user-1",
      sourceServiceTrackId: "source-track",
    });

    expect(result).toEqual({ count: 2 });
    expect(mocks.syncRuleUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        isEnabled: true,
        OR: [
          { sourceService: "SPOTIFY", sourcePlaylistId: "sp-1" },
          { sourceService: "YOUTUBE", sourcePlaylistId: "yt-1" },
        ],
      },
      data: { nextRunAt: null },
    });
  });

  test("schedules follow-up sync for a batch of resolved source tracks with deduped source playlists", async () => {
    mocks.playlistTrackStateFindMany.mockResolvedValue([
      { playlist: { service: "SPOTIFY", servicePlaylistId: "sp-1" } },
      { playlist: { service: "SPOTIFY", servicePlaylistId: "sp-1" } },
      { playlist: { service: "SOUNDCLOUD", servicePlaylistId: "sc-1" } },
    ]);
    mocks.syncRuleUpdateMany.mockResolvedValue({ count: 2 });

    const result = await scheduleManualMatchFollowupSyncs({
      userId: "user-1",
      sourceServiceTrackIds: ["source-track", "source-track", "source-track-2"],
    });

    expect(result).toEqual({ count: 2 });
    expect(mocks.playlistTrackStateFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        serviceTrackId: { in: ["source-track", "source-track-2"] },
      }),
    }));
    expect(mocks.syncRuleUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        isEnabled: true,
        OR: [
          { sourceService: "SPOTIFY", sourcePlaylistId: "sp-1" },
          { sourceService: "SOUNDCLOUD", sourcePlaylistId: "sc-1" },
        ],
      },
      data: { nextRunAt: null },
    });
  });

  test("does not schedule anything when the source track is not in an active playlist", async () => {
    mocks.playlistTrackStateFindMany.mockResolvedValue([]);

    const result = await scheduleManualMatchFollowupSync({
      userId: "user-1",
      sourceServiceTrackId: "source-track",
    });

    expect(result).toEqual({ count: 0 });
    expect(mocks.syncRuleUpdateMany).not.toHaveBeenCalled();
  });
});
