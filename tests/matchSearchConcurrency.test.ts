import { describe, expect, it, vi } from "vitest";
import type { MusicServiceAdapter } from "../lib/services/MusicServiceAdapter";
import type { NormalizedTrack } from "../lib/sync/syncTypes";

const db = vi.hoisted(() => ({
  findMany: vi.fn(async () => []),
  queryRaw: vi.fn(async () => []),
  executeRaw: vi.fn(async () => 0),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    serviceTrack: { findMany: db.findMany },
    $transaction: vi.fn(async (run) => run({ $queryRaw: db.queryRaw, $executeRaw: db.executeRaw })),
  },
}));

import { findMatch } from "../lib/sync/matchEngine";

describe("external match search", () => {
  it("runs browser search queries serially by default", async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const adapter = {
      async searchTrack() {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return [];
      },
    } as unknown as MusicServiceAdapter;
    const sourceTrack: NormalizedTrack = {
      title: "Test Song",
      artists: ["Test Artist"],
      sourceService: "youtube",
      sourceTrackId: "source-1",
    };

    await expect(findMatch(sourceTrack, "soundcloud", adapter)).resolves.toBeNull();

    expect(calls).toBeGreaterThan(1);
    expect(maxActive).toBe(1);
  });
});
