import { describe, expect, test } from "vitest";
import { parseSyncJobStats } from "@/lib/sync/syncJobStats";

describe("sync job stats", () => {
  test("keeps valid outcome counts", () => {
    expect(
      parseSyncJobStats(
        JSON.stringify({ synced: 3, alreadySynced: 8, notFound: 2, manualRequired: 1, removed: 4 }),
      ),
    ).toEqual({ synced: 3, alreadySynced: 8, notFound: 2, manualRequired: 1, removed: 4 });
  });

  test("falls back safely for malformed or invalid counts", () => {
    expect(parseSyncJobStats("not-json")).toEqual({
      synced: 0,
      alreadySynced: 0,
      notFound: 0,
      manualRequired: 0,
      removed: 0,
    });
    expect(parseSyncJobStats(JSON.stringify({ synced: -2, notFound: "4" })).synced).toBe(0);
  });
});
