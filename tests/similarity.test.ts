import { describe, expect, it } from "vitest";
import { calculateSimilarity } from "../lib/utils/similarity";
import type { NormalizedTrack } from "../lib/sync/syncTypes";

const base: NormalizedTrack = {
  title: "Blinding Lights",
  artists: ["The Weeknd"],
  album: "After Hours",
  durationMs: 200040,
  isrc: "USUG11904166",
  sourceService: "spotify",
  sourceTrackId: "sp_1",
};

describe("track similarity", () => {
  it("returns a perfect match for identical ISRC values", () => {
    expect(calculateSimilarity(base, { ...base, sourceService: "youtube", sourceTrackId: "yt_1" })).toBe(1);
  });

  it("keeps decorated platform titles highly similar", () => {
    const score = calculateSimilarity(base, {
      ...base,
      title: "The Weeknd - Blinding Lights (Official Audio)",
      isrc: undefined,
      sourceService: "youtube",
      sourceTrackId: "yt_2",
      durationMs: 200300,
    });

    expect(score).toBeGreaterThan(0.82);
  });

  it("penalizes unrelated tracks", () => {
    const score = calculateSimilarity(base, {
      title: "Midnight City",
      artists: ["M83"],
      album: "Hurry Up, We're Dreaming",
      durationMs: 243960,
      sourceService: "soundcloud",
      sourceTrackId: "sc_1",
    });

    expect(score).toBeLessThan(0.35);
  });
});
