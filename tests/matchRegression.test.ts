import { describe, expect, it } from "vitest";
import fixture from "./fixtures/match-regression.json";
import { AUTO_MATCH_THRESHOLD } from "../lib/sync/matchThresholds";
import type { NormalizedTrack, ServiceKey } from "../lib/sync/syncTypes";
import { calculateSimilarity } from "../lib/utils/similarity";

type FixtureTrack = {
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  sourceService: ServiceKey;
};

function normalized(track: FixtureTrack, sourceTrackId: string): NormalizedTrack {
  return {
    title: track.title,
    artists: track.artists,
    album: track.album ?? undefined,
    durationMs: track.durationMs ?? undefined,
    isrc: track.isrc ?? undefined,
    sourceService: track.sourceService,
    sourceTrackId,
  };
}

describe("matcher regression corpus", () => {
  it("keeps the calibrated threshold at 100% precision and recall", () => {
    expect(fixture.threshold).toBe(AUTO_MATCH_THRESHOLD);
    expect(fixture.cases).toHaveLength(47);

    const results = fixture.cases.map((item, index) => {
      const score = calculateSimilarity(
        normalized(item.source as FixtureTrack, `source-${index}`),
        normalized(item.candidate as FixtureTrack, `candidate-${index}`),
      );
      return { ...item, score, predicted: score >= AUTO_MATCH_THRESHOLD };
    });
    const accepted = results.filter((item) => item.accepted);
    const rejected = results.filter((item) => !item.accepted);
    const falsePositives = rejected.filter((item) => item.predicted);
    const falseNegatives = accepted.filter((item) => !item.predicted);
    const truePositives = accepted.length - falseNegatives.length;
    const precision = truePositives / (truePositives + falsePositives.length);
    const recall = truePositives / accepted.length;

    expect({ accepted: accepted.length, rejected: rejected.length, precision, recall }).toEqual({
      accepted: 44,
      rejected: 3,
      precision: 1,
      recall: 1,
    });
    expect({
      falsePositives: falsePositives.map((item) => `${item.source.title} => ${item.candidate.title}`),
      falseNegatives: falseNegatives.map((item) => `${item.source.title} => ${item.candidate.title}`),
    }).toEqual({ falsePositives: [], falseNegatives: [] });
  });
});
