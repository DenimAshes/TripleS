import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  rateLimit: vi.fn(),
  runDueSyncRules: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/auth/rateLimit", () => ({
  rateLimit: mocks.rateLimit,
}));

vi.mock("@/lib/services/dueSyncRunner", () => ({
  runDueSyncRules: mocks.runDueSyncRules,
}));

import { POST } from "../app/api/sync/queue/run-due/route";

describe("/api/sync/queue/run-due", () => {
  beforeEach(() => {
    mocks.requireAuth.mockReset();
    mocks.rateLimit.mockReset();
    mocks.runDueSyncRules.mockReset();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.rateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
    mocks.runDueSyncRules.mockResolvedValue({
      jobs: [{ id: "job-1" }],
      failures: [],
      skipped: [],
      summary: { due: 1, succeeded: 1, failed: 0, skipped: 0, staleMarked: 0 },
    });
  });

  test("runs due rules for the authenticated user", async () => {
    const request = new Request("http://localhost/api/sync/queue/run-due", { method: "POST" });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireAuth).toHaveBeenCalledWith(request);
    expect(mocks.rateLimit).toHaveBeenCalledWith("sync.queue.run-due:user-1", { windowMs: 60_000, max: 4 });
    expect(mocks.runDueSyncRules).toHaveBeenCalledWith({ userId: "user-1" });
    expect(payload.summary).toEqual({ due: 1, succeeded: 1, failed: 0, skipped: 0, staleMarked: 0 });
  });

  test("rate limits repeated manual queue runs", async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, retryAfterMs: 12_000 });

    const response = await POST(new Request("http://localhost/api/sync/queue/run-due", { method: "POST" }));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(payload).toEqual({ error: "Too many queue runs. Wait a moment and try again." });
    expect(mocks.runDueSyncRules).not.toHaveBeenCalled();
  });
});
