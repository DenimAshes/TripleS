export const ACCIDENTAL_SMOKE_WINDOWS = [
  { start: "2026-08-19T17:30:00.000Z", end: "2026-08-19T18:00:00.000Z" },
  { start: "2026-08-19T18:45:00.000Z", end: "2026-08-19T19:00:00.000Z" },
] as const;

export const ACCIDENTAL_SMOKE_CONFIRMATION = "DELETE_2026_08_19_UI_SMOKE_DECISIONS";

export type AccidentalSmokeCleanupCounts = {
  trackMatches: number;
  negativeCaches: number;
  acceptedCandidates: number;
  rejectedCandidates: number;
};

const EXPECTED_COUNTS: AccidentalSmokeCleanupCounts = {
  trackMatches: 30,
  negativeCaches: 37,
  acceptedCandidates: 36,
  rejectedCandidates: 27,
};

export function accidentalSmokeCleanupMismatches(actual: AccidentalSmokeCleanupCounts) {
  return (Object.keys(EXPECTED_COUNTS) as Array<keyof AccidentalSmokeCleanupCounts>)
    .filter((key) => actual[key] !== EXPECTED_COUNTS[key])
    .map((key) => `${key}: expected ${EXPECTED_COUNTS[key]}, found ${actual[key]}`);
}
