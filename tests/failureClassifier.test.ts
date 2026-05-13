import { describe, expect, it } from "vitest";
import { FAILURE_COOLDOWN_MS, isCooldownError, nextRunAfterFailure } from "../lib/sync/failureClassifier";

describe("isCooldownError", () => {
  it("catches captcha block messages", () => {
    expect(isCooldownError(new Error("SoundCloud blocked the write request with captcha."))).toBe(true);
  });

  it("catches expired-session messages", () => {
    expect(isCooldownError(new Error("YouTube user is not logged in"))).toBe(true);
    expect(isCooldownError(new Error("No saved soundcloud browser session at /worker/state/soundcloud.json"))).toBe(true);
  });

  it("does not flag transient errors", () => {
    expect(isCooldownError(new Error("ECONNRESET"))).toBe(false);
    expect(isCooldownError(new Error("Timeout 30000ms exceeded"))).toBe(false);
    expect(isCooldownError(new Error("Element not found"))).toBe(false);
  });
});

describe("nextRunAfterFailure", () => {
  const now = new Date("2026-05-13T12:00:00.000Z");

  it("schedules 24h cooldown for captcha-class errors", () => {
    const next = nextRunAfterFailure(60, new Error("captcha"), now);
    expect(next?.getTime()).toBe(now.getTime() + FAILURE_COOLDOWN_MS);
  });

  it("uses normal interval for transient errors", () => {
    const next = nextRunAfterFailure(60, new Error("ECONNRESET"), now);
    expect(next?.getTime()).toBe(now.getTime() + 60 * 60_000);
  });

  it("returns null when intervalMinutes is 0 and error is transient", () => {
    expect(nextRunAfterFailure(0, new Error("ECONNRESET"), now)).toBeNull();
  });

  it("still cools down 24h when intervalMinutes is 0 but error is captcha-class", () => {
    const next = nextRunAfterFailure(0, new Error("not logged in"), now);
    expect(next?.getTime()).toBe(now.getTime() + FAILURE_COOLDOWN_MS);
  });
});
