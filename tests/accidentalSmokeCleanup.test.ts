import { describe, expect, test } from "vitest";
import { accidentalSmokeCleanupMismatches } from "@/lib/sync/accidentalSmokeCleanup";

describe("accidental smoke cleanup guard", () => {
  test("accepts only the recorded artifact counts", () => {
    expect(
      accidentalSmokeCleanupMismatches({
        trackMatches: 30,
        negativeCaches: 37,
        acceptedCandidates: 36,
        rejectedCandidates: 27,
      }),
    ).toEqual([]);

    expect(
      accidentalSmokeCleanupMismatches({
        trackMatches: 29,
        negativeCaches: 37,
        acceptedCandidates: 36,
        rejectedCandidates: 27,
      }),
    ).toEqual(["trackMatches: expected 30, found 29"]);
  });
});
