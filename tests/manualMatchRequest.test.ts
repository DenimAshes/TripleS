import { describe, expect, test } from "vitest";
import {
  ManualMatchRequestError,
  parseBulkThreshold,
  parseManualMatchAlternatives,
  parsePreviewFlag,
} from "../lib/services/manualMatchRequest";

describe("manual match request parsing", () => {
  test("parses threshold values", () => {
    expect(parseBulkThreshold(undefined, 0.85)).toBe(0.85);
    expect(parseBulkThreshold(0, 0.85)).toBe(0);
    expect(parseBulkThreshold(1, 0.85)).toBe(1);
    expect(parseBulkThreshold("0.72", 0.85)).toBe(0.72);
  });

  test("rejects invalid thresholds instead of clamping", () => {
    expect(() => parseBulkThreshold(-0.1, 0.85)).toThrow(ManualMatchRequestError);
    expect(() => parseBulkThreshold(1.1, 0.85)).toThrow(ManualMatchRequestError);
    expect(() => parseBulkThreshold("bad", 0.85)).toThrow(ManualMatchRequestError);
  });

  test("parses preview flag from boolean or string", () => {
    expect(parsePreviewFlag(true)).toBe(true);
    expect(parsePreviewFlag("true")).toBe(true);
    expect(parsePreviewFlag(false)).toBe(false);
    expect(parsePreviewFlag("false")).toBe(false);
  });

  test("parses alternatives safely", () => {
    expect(
      parseManualMatchAlternatives(
        JSON.stringify([
          { serviceTrackId: "a", confidence: 0.9, breakdown: { titleScore: 1 } },
          { serviceTrackId: "a", confidence: 0.8 },
          { serviceTrackId: "b", confidence: 2 },
          { serviceTrackId: "", confidence: 0.7 },
          null,
        ]),
      ),
    ).toEqual([{ serviceTrackId: "a", confidence: 0.9, breakdown: { titleScore: 1 } }]);
    expect(parseManualMatchAlternatives("bad json")).toEqual([]);
    expect(parseManualMatchAlternatives(null)).toEqual([]);
  });
});
