import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  startBrowserActionJob: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/services/browserActionJobs", async () => {
  const actual = await vi.importActual<typeof import("../lib/services/browserActionJobs")>(
    "../lib/services/browserActionJobs",
  );
  return {
    ...actual,
    startBrowserActionJob: mocks.startBrowserActionJob,
  };
});

import { POST } from "../app/api/sync/run/route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/sync/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/sync/run", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.startBrowserActionJob.mockReset();
  });

  test("queues a sync.run BrowserJob and returns 202", async () => {
    mocks.startBrowserActionJob.mockResolvedValue({
      id: "job-sync",
      userId: "user-1",
      type: "sync.run",
      status: "queued",
      input: { syncRuleId: "rule-1" },
      result: null,
      error: null,
      errorCode: null,
      errorDetails: null,
      currentStep: "Queued",
      claimedAt: null,
      workerId: null,
      attempts: 0,
      startedAt: new Date("2026-05-15T00:00:00.000Z"),
      finishedAt: null,
    });

    const response = await POST(request({ syncRuleId: "rule-1" }));
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(mocks.startBrowserActionJob).toHaveBeenCalledWith("user-1", "sync.run", { syncRuleId: "rule-1" });
    expect(payload.job).toMatchObject({ id: "job-sync", type: "sync.run", status: "queued" });
  });
});
