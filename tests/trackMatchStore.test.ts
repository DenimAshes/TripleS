import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  trackMatchDeleteMany: vi.fn(),
  serviceTrackDeleteMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import { invalidateDestinationTrack, shouldInvalidateDestinationTrack } from "@/lib/sync/trackMatchStore";

describe("stored track matches", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.transaction.mockImplementation(async (callback) => callback({
      trackMatch: { deleteMany: mocks.trackMatchDeleteMany },
      serviceTrack: { deleteMany: mocks.serviceTrackDeleteMany },
    }));
  });

  test("invalidates a missing automatic destination but not a manual override", () => {
    expect(shouldInvalidateDestinationTrack("stored", new Error("SoundCloud track not found."))).toBe(true);
    expect(shouldInvalidateDestinationTrack("local_catalog", new Error("SoundCloud track not found."))).toBe(true);
    expect(shouldInvalidateDestinationTrack("manual_override", new Error("SoundCloud track not found."))).toBe(false);
    expect(shouldInvalidateDestinationTrack("stored", new Error("SoundCloud playlist not found."))).toBe(false);
  });

  test("deletes the match and an unreferenced cached destination track", async () => {
    mocks.trackMatchDeleteMany.mockResolvedValue({ count: 1 });
    mocks.serviceTrackDeleteMany.mockResolvedValue({ count: 1 });

    await expect(invalidateDestinationTrack("internal-1", "SOUNDCLOUD", "target-1")).resolves.toEqual({
      matches: 1,
      tracks: 1,
    });

    expect(mocks.trackMatchDeleteMany).toHaveBeenCalledWith({
      where: {
        internalTrackId: "internal-1",
        soundcloudServiceTrackId: "target-1",
        status: { in: ["CONFIRMED", "AUTO_MATCHED"] },
      },
    });
    expect(mocks.serviceTrackDeleteMany).toHaveBeenCalledWith({
      where: { id: "target-1", playlistStates: { none: {} } },
    });
  });
});
