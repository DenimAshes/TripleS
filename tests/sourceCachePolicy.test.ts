import { describe, expect, test } from "vitest";
import { shouldRefreshSourceCache, sourceCacheMaxAgeMs } from "../lib/sync/sourceCachePolicy";

describe("source cache policy", () => {
  test("defaults to a short monitoring cache window", () => {
    expect(sourceCacheMaxAgeMs(undefined)).toBe(120_000);
  });

  test("refreshes missing or stale snapshots", () => {
    const now = new Date("2026-05-15T00:05:00.000Z");

    expect(shouldRefreshSourceCache({ lastFetchedAt: null, now })).toBe(true);
    expect(shouldRefreshSourceCache({ lastFetchedAt: new Date("2026-05-15T00:00:00.000Z"), now, maxAgeMs: 120_000 })).toBe(true);
    expect(shouldRefreshSourceCache({ lastFetchedAt: new Date("2026-05-15T00:04:00.000Z"), now, maxAgeMs: 120_000 })).toBe(false);
  });

  test("supports forced refresh and disabling age refresh", () => {
    const now = new Date("2026-05-15T00:05:00.000Z");
    const old = new Date("2026-05-15T00:00:00.000Z");

    expect(shouldRefreshSourceCache({ lastFetchedAt: old, now, maxAgeMs: 0 })).toBe(false);
    expect(shouldRefreshSourceCache({ lastFetchedAt: old, now, maxAgeMs: 0, forceRefresh: true })).toBe(true);
  });
});
