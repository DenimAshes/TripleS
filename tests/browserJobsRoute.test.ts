import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  startBrowserActionJob: vi.fn(),
  syncRuleFindFirst: vi.fn(),
  playlistFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    syncRule: {
      findFirst: mocks.syncRuleFindFirst,
    },
    playlist: {
      findFirst: mocks.playlistFindFirst,
    },
  },
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

import { POST } from "../app/api/browser-jobs/route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/browser-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function queuedJob() {
  return {
    id: "job-1",
    userId: "user-1",
    type: "sync.run" as const,
    status: "queued" as const,
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
  };
}

describe("/api/browser-jobs", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.startBrowserActionJob.mockReset();
    mocks.syncRuleFindFirst.mockReset();
    mocks.playlistFindFirst.mockReset();
    mocks.syncRuleFindFirst.mockResolvedValue({ id: "rule-1" });
    mocks.playlistFindFirst.mockResolvedValue({ id: "playlist-1" });
  });

  test("returns 202 with a queued browser job", async () => {
    mocks.startBrowserActionJob.mockResolvedValue(queuedJob());

    const response = await POST(request({ type: "sync.run", input: { syncRuleId: "rule-1" } }));
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(mocks.startBrowserActionJob).toHaveBeenCalledWith("user-1", "sync.run", { syncRuleId: "rule-1" });
    expect(payload.job).toMatchObject({
      id: "job-1",
      type: "sync.run",
      status: "queued",
      currentStep: "Queued",
      workerId: null,
      attempts: 0,
    });
  });

  test("rejects unsupported job types", async () => {
    const response = await POST(request({ type: "unknown.action" }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Unsupported job type");
    expect(mocks.startBrowserActionJob).not.toHaveBeenCalled();
  });

  test("rejects sync.run without a rule id", async () => {
    const response = await POST(request({ type: "sync.run", input: {} }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("syncRuleId is required");
    expect(mocks.startBrowserActionJob).not.toHaveBeenCalled();
  });

  test("rejects sync.run for another user's rule", async () => {
    mocks.syncRuleFindFirst.mockResolvedValue(null);

    const response = await POST(request({ type: "sync.run", input: { syncRuleId: "other-rule" } }));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe("Sync rule not found");
    expect(mocks.startBrowserActionJob).not.toHaveBeenCalled();
  });

  test("rejects playlist refresh for another user's playlist", async () => {
    mocks.playlistFindFirst.mockResolvedValue(null);

    const response = await POST(request({ type: "playlistTracks.refresh", input: { playlistId: "other-playlist" } }));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe("Playlist not found");
    expect(mocks.startBrowserActionJob).not.toHaveBeenCalled();
  });
});
