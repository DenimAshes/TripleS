import { describe, expect, test } from "vitest";
import { classifySyncError, isSyncError, preflightReasonToCode, SyncError } from "../lib/sync/syncErrors";

describe("SyncError classification", () => {
  test("preserves SyncError instances", () => {
    const original = new SyncError("RATE_LIMITED", "slow down");
    expect(classifySyncError(original)).toBe(original);
  });

  test("maps timeout errors", () => {
    expect(classifySyncError(new Error("browser runner timed out after 90000ms")).code).toBe("RUNNER_TIMEOUT");
  });

  test("maps captcha errors", () => {
    const error = classifySyncError(new Error("SoundCloud captcha required"));
    expect(error.code).toBe("CAPTCHA_BLOCKED");
    expect(error.details.recommendedAction).toBeTruthy();
  });

  test("maps schema mismatch errors", () => {
    expect(classifySyncError(new Error("The column Playlist.url does not exist in the current database.")).code).toBe("DB_SCHEMA_MISMATCH");
  });

  test("maps preflight incomplete cache messages", () => {
    const error = classifySyncError(
      new Error("Preflight failed for SyncRule x: Source playlist YOUTUBE:mix has incomplete cache (93/171 active). Refresh playlist tracks before running sync."),
    );
    expect(error.code).toBe("SOURCE_CACHE_INCOMPLETE");
    expect(error.details.activeTracks).toBe(93);
    expect(error.details.expectedTracks).toBe(171);
  });

  test("isSyncError only matches SyncError", () => {
    expect(isSyncError(new SyncError("UNKNOWN", "x"))).toBe(true);
    expect(isSyncError(new Error("x"))).toBe(false);
  });
});

describe("preflightReasonToCode", () => {
  test("maps destination not writable", () => {
    expect(preflightReasonToCode("Destination playlist SOUNDCLOUD:mix is not writable.").code).toBe("DESTINATION_NOT_WRITABLE");
  });

  test("maps no destinations", () => {
    expect(preflightReasonToCode("No enabled destinations.").code).toBe("NO_DESTINATIONS");
  });
});
