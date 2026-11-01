import { describe, expect, it } from "vitest";
import { classifyRecentJobStatuses } from "../lib/sync/syncDoctorHealth";

describe("sync doctor health", () => {
  it("fails only after repeated failures", () => {
    expect(classifyRecentJobStatuses(["SUCCESS", "FAILED"])).toBe("OK");
    expect(classifyRecentJobStatuses(["PARTIAL_SUCCESS", "FAILED"])).toBe("OK");
    expect(classifyRecentJobStatuses(["FAILED", "SUCCESS"])).toBe("WARN");
    expect(classifyRecentJobStatuses(["FAILED", "FAILED"])).toBe("FAIL");
  });
});
