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

  // SoundCloud carries no album and, for label-owned tracks, no usable length
  // either. A pair that agrees on everything it does expose must still clear the
  // manual-review floor, and must not be dragged down by the snippet duration
  // the api used to report as the real one.
  it("keeps a title and artist match reviewable when the length is unknown", () => {
    const source: NormalizedTrack = {
      title: "Владимирский централ",
      artists: ["Михаил Круг"],
      durationMs: 268000,
      sourceService: "youtube",
      sourceTrackId: "yt_3",
    };
    const withoutDuration = calculateSimilarity(source, {
      title: "Владимирский централ",
      artists: ["Михаил Круг"],
      sourceService: "soundcloud",
      sourceTrackId: "sc_2",
    });
    const withSnippetDuration = calculateSimilarity(source, {
      title: "Владимирский централ",
      artists: ["Михаил Круг"],
      durationMs: 30000,
      sourceService: "soundcloud",
      sourceTrackId: "sc_2",
    });

    // 0.65 is the manual-review floor (WORKER_MANUAL_REVIEW_THRESHOLD): the
    // snippet length pushes an otherwise perfect pair under it, so the sync
    // reported the track as not found at all.
    expect(withoutDuration).toBeGreaterThan(0.65);
    expect(withSnippetDuration).toBeLessThan(0.65);
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
