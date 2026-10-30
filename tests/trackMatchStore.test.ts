import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deleteMany: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    trackMatch: { deleteMany: mocks.deleteMany },
  },
}));

import { deleteStoredTrackMatch, shouldInvalidateStoredTrackMatch } from "@/lib/sync/trackMatchStore";

describe("stored track matches", () => {
  beforeEach(() => mocks.deleteMany.mockReset());

  test("invalidates only a missing remote track selected from stored matches", () => {
    expect(shouldInvalidateStoredTrackMatch("stored", new Error("SoundCloud track not found."))).toBe(true);
    expect(shouldInvalidateStoredTrackMatch("search", new Error("SoundCloud track not found."))).toBe(false);
    expect(shouldInvalidateStoredTrackMatch("stored", new Error("SoundCloud playlist not found."))).toBe(false);
  });

  test("deletes the matching destination link", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });

    await deleteStoredTrackMatch("internal-1", "SOUNDCLOUD", "target-1");

    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        internalTrackId: "internal-1",
        soundcloudServiceTrackId: "target-1",
        status: { in: ["CONFIRMED", "AUTO_MATCHED"] },
      },
    });
  });
});
