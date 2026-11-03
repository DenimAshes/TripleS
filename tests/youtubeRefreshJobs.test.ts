import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/youtube/youtubeCache", () => ({
  refreshYouTubePlaylistTracks: vi.fn(async () => ({ tracks: [], lastFetchedAt: new Date() })),
}));

import {
  getYouTubeTrackRefreshJob,
  startYouTubeTrackRefreshJob,
} from "@/lib/services/youtube/youtubeRefreshJobs";

describe("youtubeRefreshJobs", () => {
  afterEach(() => vi.useRealTimers());

  it("drops completed in-memory jobs after their retention window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T00:00:00Z"));

    startYouTubeTrackRefreshJob("user-1", "playlist-1");
    await Promise.resolve();
    await Promise.resolve();

    expect(getYouTubeTrackRefreshJob("user-1", "playlist-1")?.status).toBe("completed");

    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(getYouTubeTrackRefreshJob("user-1", "playlist-1")).toBeNull();
  });
});
