import { describe, expect, it } from "vitest";
import { calculateSimilarity } from "../lib/utils/similarity";
import { scoreStoredMatch } from "../lib/sync/matchEngine";
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

  it("re-scores automatic stored matches but keeps manual confirmations trusted", () => {
    const target: NormalizedTrack = {
      title: "5 минут назад",
      artists: ["Boulevard Depo"],
      durationMs: 221773,
      sourceService: "soundcloud",
      sourceTrackId: "sc_stored",
    };
    const source: NormalizedTrack = {
      title: "5 минут назад",
      artists: ["PHARAOH un Boulevard Depo Плакшери"],
      album: "Плакшери",
      durationMs: 222000,
      sourceService: "youtube",
      sourceTrackId: "yt_stored",
    };

    const automatic = scoreStoredMatch(source, { track: target, confidence: 0.82, status: "AUTO_MATCHED" });
    const confirmed = scoreStoredMatch(base, { track: target, confidence: 0.2, status: "CONFIRMED" });

    expect(automatic.confidence).toBeGreaterThanOrEqual(0.85);
    expect(automatic.source).toBe("stored_rescored");
    expect(confirmed.confidence).toBe(1);
    expect(confirmed.source).toBe("stored_confirmed");
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

  it("does not charge SoundCloud for album metadata it does not provide", () => {
    const source: NormalizedTrack = {
      title: "Ice Baby",
      artists: ["Guf Doma"],
      album: "Doma",
      durationMs: 253000,
      sourceService: "youtube",
      sourceTrackId: "yt_4",
    };
    const score = calculateSimilarity(source, {
      title: "Ice Baby",
      artists: ["Guf"],
      durationMs: 252000,
      sourceService: "soundcloud",
      sourceTrackId: "sc_3",
    });

    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  it("auto-matches an exact title and duration despite unreliable uploader names", () => {
    const score = calculateSimilarity(
      {
        title: "Егор Крид - Невеста",
        artists: ["Егор Крид Холостяк"],
        durationMs: 207000,
        sourceService: "youtube",
        sourceTrackId: "yt_bride",
      },
      {
        title: "Егор Крид - Невеста (Премьера Клипа, 2015)",
        artists: ["Самед Садыхов"],
        durationMs: 208634,
        sourceService: "soundcloud",
        sourceTrackId: "sc_bride",
      },
    );

    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  it("removes an album or title appended to the YouTube artist byline", () => {
    const score = calculateSimilarity(
      {
        title: "Chao, bambino (Чао, бамбино)",
        artists: ["CarMan Car-Mania"],
        album: "Car-Mania",
        sourceService: "youtube",
        sourceTrackId: "yt_carman",
      },
      {
        title: "Chao, bambino (Чао, бамбино)",
        artists: ["CarMan"],
        sourceService: "soundcloud",
        sourceTrackId: "sc_carman",
      },
    );

    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  it("does not auto-match a cover hidden in the artist byline", () => {
    const score = calculateSimilarity(
      {
        title: "Сумасшедшая",
        artists: ["Comedy Club Cover, Алексей Воробьёв"],
        durationMs: 115000,
        sourceService: "youtube",
        sourceTrackId: "yt_cover",
      },
      {
        title: "Сумасшедшая (ПОШЛАЯ МОЛЛИ)",
        artists: ["Мэнди/Mandy"],
        durationMs: 111709,
        sourceService: "soundcloud",
        sourceTrackId: "sc_cover",
      },
    );

    expect(score).toBeLessThan(0.85);
  });

  it("recognizes a Russian cover label", () => {
    const score = calculateSimilarity(
      {
        title: "Блядская натура",
        artists: ["LoToR"],
        durationMs: 183000,
        sourceService: "youtube",
        sourceTrackId: "yt_original",
      },
      {
        title: "Блядская натура (LoToR кавер)",
        artists: ["Второй Шанс"],
        durationMs: 182000,
        sourceService: "soundcloud",
        sourceTrackId: "sc_russian_cover",
      },
    );

    expect(score).toBeLessThan(0.85);
  });

  it("keeps a live version below the auto-match threshold without album metadata", () => {
    const score = calculateSimilarity(
      { ...base, isrc: undefined },
      {
        title: "Save Your Tears (Live)",
        artists: ["The Weeknd"],
        durationMs: 219000,
        sourceService: "soundcloud",
        sourceTrackId: "sc_live",
      },
    );

    expect(score).toBeLessThan(0.85);
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
