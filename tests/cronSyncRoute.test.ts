import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncRuleFindMany: vi.fn(),
  syncJobFindMany: vi.fn(),
  syncJobUpdateMany: vi.fn(),
  syncJobFindFirst: vi.fn(),
  playlistFindUnique: vi.fn(),
  playlistGroupMemberFindMany: vi.fn(),
  getServicesInCooldown: vi.fn(),
  preflightSyncRule: vi.fn(),
  runSync: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    syncRule: {
      findMany: mocks.syncRuleFindMany,
    },
    syncJob: {
      findMany: mocks.syncJobFindMany,
      updateMany: mocks.syncJobUpdateMany,
      findFirst: mocks.syncJobFindFirst,
    },
    playlist: {
      findUnique: mocks.playlistFindUnique,
    },
    playlistGroupMember: {
      findMany: mocks.playlistGroupMemberFindMany,
    },
  },
}));

vi.mock("@/lib/sync/preflight", () => ({
  preflightSyncRule: mocks.preflightSyncRule,
}));

vi.mock("@/lib/sync/syncEngine", () => ({
  runSync: mocks.runSync,
}));

vi.mock("@/lib/sync/serviceCooldown", () => ({
  getServicesInCooldown: mocks.getServicesInCooldown,
}));

import { GET } from "../app/api/cron/sync/route";

function request(secret?: string): Request {
  const url = secret ? `http://localhost/api/cron/sync?secret=${secret}` : "http://localhost/api/cron/sync";
  return new Request(url);
}

describe("/api/cron/sync", () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.CRON_MAX_RULES_PER_RUN;
    delete process.env.CRON_RUNNING_JOB_TIMEOUT_MINUTES;
    mocks.syncRuleFindMany.mockReset();
    mocks.syncJobFindMany.mockReset();
    mocks.syncJobUpdateMany.mockReset();
    mocks.syncJobFindFirst.mockReset();
    mocks.playlistFindUnique.mockReset();
    mocks.playlistGroupMemberFindMany.mockReset();
    mocks.getServicesInCooldown.mockReset();
    mocks.preflightSyncRule.mockReset();
    mocks.runSync.mockReset();
    mocks.syncJobFindMany.mockResolvedValue([]);
    mocks.syncJobUpdateMany.mockResolvedValue({ count: 0 });
    mocks.syncJobFindFirst.mockResolvedValue(null);
    mocks.playlistFindUnique.mockResolvedValue({ lastFetchedAt: new Date() });
    mocks.playlistGroupMemberFindMany.mockResolvedValue([]);
    mocks.getServicesInCooldown.mockResolvedValue(new Set());
    mocks.preflightSyncRule.mockResolvedValue({ ok: true, reasons: [] });
  });

  test("continues running due rules after one rule fails", async () => {
    mocks.syncRuleFindMany.mockResolvedValue([
      { id: "rule-1", name: "Rule one", sourceService: "SPOTIFY", destinations: [{ service: "YOUTUBE" }] },
      { id: "rule-2", name: "Rule two", sourceService: "YOUTUBE", destinations: [{ service: "SPOTIFY" }] },
    ]);
    mocks.runSync
      .mockRejectedValueOnce(new Error("Needs login"))
      .mockResolvedValueOnce({ id: "job-2", status: "SUCCEEDED" });

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.runSync).toHaveBeenCalledTimes(2);
    expect(mocks.runSync).toHaveBeenNthCalledWith(1, "rule-1");
    expect(mocks.runSync).toHaveBeenNthCalledWith(2, "rule-2");
    expect(payload.summary).toEqual({ due: 2, succeeded: 1, failed: 1, skipped: 0, staleMarked: 0 });
    expect(payload.failures).toEqual([{ syncRuleId: "rule-1", name: "Rule one", error: "Needs login" }]);
    expect(payload.jobs).toEqual([{ id: "job-2", status: "SUCCEEDED" }]);
  });

  test("skips rules blocked by service cooldown", async () => {
    mocks.syncRuleFindMany.mockResolvedValue([
      { id: "rule-1", name: "Rule one", sourceService: "SPOTIFY", destinations: [{ service: "YOUTUBE" }] },
      { id: "rule-2", name: "Rule two", sourceService: "SOUNDCLOUD", destinations: [{ service: "SPOTIFY" }] },
    ]);
    mocks.getServicesInCooldown.mockResolvedValue(new Set(["youtube"]));
    mocks.runSync.mockResolvedValue({ id: "job-2", status: "SUCCEEDED" });

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
    expect(mocks.runSync).toHaveBeenCalledWith("rule-2");
    expect(mocks.preflightSyncRule).toHaveBeenCalledTimes(1);
    expect(payload.skipped).toEqual([
      { syncRuleId: "rule-1", name: "Rule one", reason: "cooldown", detail: "youtube is in cooldown" },
    ]);
    expect(payload.summary).toEqual({ due: 2, succeeded: 1, failed: 0, skipped: 1, staleMarked: 0 });
  });

  test("skips rules that fail preflight", async () => {
    mocks.syncRuleFindMany.mockResolvedValue([
      { id: "rule-1", name: "Rule one", sourceService: "SPOTIFY", destinations: [{ service: "YOUTUBE" }] },
    ]);
    mocks.preflightSyncRule.mockResolvedValue({ ok: false, reasons: ["No enabled destinations."] });

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.runSync).not.toHaveBeenCalled();
    expect(payload.skipped).toEqual([
      { syncRuleId: "rule-1", name: "Rule one", reason: "preflight", detail: "No enabled destinations." },
    ]);
    expect(payload.summary).toEqual({ due: 1, succeeded: 0, failed: 0, skipped: 1, staleMarked: 0 });
  });

  test("allows incomplete source cache preflight when source snapshot is stale", async () => {
    mocks.syncRuleFindMany.mockResolvedValue([
      { id: "rule-1", name: "Rule one", sourceService: "SPOTIFY", sourcePlaylistId: "sp-1", destinations: [{ service: "YOUTUBE" }] },
    ]);
    mocks.playlistFindUnique.mockResolvedValue({ lastFetchedAt: new Date(Date.now() - 10 * 60_000) });
    mocks.runSync.mockResolvedValue({ id: "job-1", status: "SUCCEEDED" });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.playlistFindUnique).toHaveBeenCalledWith({
      where: {
        service_servicePlaylistId: {
          service: "SPOTIFY",
          servicePlaylistId: "sp-1",
        },
      },
      select: { lastFetchedAt: true },
    });
    expect(mocks.preflightSyncRule).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rule-1" }),
      { allowIncompleteSourceCache: true },
    );
  });

  test("marks stale running jobs before checking active running jobs", async () => {
    mocks.syncRuleFindMany.mockResolvedValue([
      { id: "rule-1", name: "Rule one", sourceService: "SPOTIFY", destinations: [{ service: "YOUTUBE" }] },
    ]);
    mocks.syncJobFindMany.mockResolvedValue([{ id: "stale-job" }]);
    mocks.syncJobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.runSync.mockResolvedValue({ id: "job-1", status: "SUCCEEDED" });

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["stale-job"] } },
      data: expect.objectContaining({
        status: "FAILED",
        finishedAt: expect.any(Date),
      }),
    });
    expect(mocks.runSync).toHaveBeenCalledWith("rule-1");
    expect(payload.summary.staleMarked).toBe(1);
  });

  test("skips active running jobs", async () => {
    const startedAt = new Date("2026-05-15T00:00:00.000Z");
    mocks.syncRuleFindMany.mockResolvedValue([
      { id: "rule-1", name: "Rule one", sourceService: "SPOTIFY", destinations: [{ service: "YOUTUBE" }] },
    ]);
    mocks.syncJobFindFirst.mockResolvedValue({ id: "running-job", startedAt });

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.preflightSyncRule).not.toHaveBeenCalled();
    expect(mocks.runSync).not.toHaveBeenCalled();
    expect(payload.skipped).toEqual([
      {
        syncRuleId: "rule-1",
        name: "Rule one",
        reason: "already_running",
        detail: "Job running-job is RUNNING since 2026-05-15T00:00:00.000Z",
      },
    ]);
  });

  test("respects CRON_MAX_RULES_PER_RUN after preflight for unrelated rules", async () => {
    process.env.CRON_MAX_RULES_PER_RUN = "1";
    mocks.syncRuleFindMany.mockResolvedValue([
      { id: "rule-1", name: "Rule one", sourceService: "SPOTIFY", destinations: [{ service: "YOUTUBE" }] },
      { id: "rule-2", name: "Rule two", sourceService: "YOUTUBE", destinations: [{ service: "SPOTIFY" }] },
    ]);
    mocks.runSync.mockResolvedValue({ id: "job-1", status: "SUCCEEDED" });

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
    expect(mocks.runSync).toHaveBeenCalledWith("rule-1");
    expect(payload.skipped).toEqual([
      { syncRuleId: "rule-2", name: "Rule two", reason: "limit", detail: "CRON_MAX_RULES_PER_RUN=1" },
    ]);
    expect(payload.summary).toEqual({ due: 2, succeeded: 1, failed: 0, skipped: 1, staleMarked: 0 });
  });

  test("does not split enabled source rules from the same playlist group when limited", async () => {
    process.env.CRON_MAX_RULES_PER_RUN = "1";
    mocks.syncRuleFindMany.mockResolvedValue([
      { id: "rule-sp", name: "Spotify source", sourceService: "SPOTIFY", sourcePlaylistId: "sp-1", destinations: [{ service: "YOUTUBE" }] },
      { id: "rule-yt", name: "YouTube source", sourceService: "YOUTUBE", sourcePlaylistId: "yt-1", destinations: [{ service: "SPOTIFY" }] },
      { id: "rule-other", name: "Other rule", sourceService: "SPOTIFY", sourcePlaylistId: "sp-2", destinations: [{ service: "SOUNDCLOUD" }] },
    ]);
    mocks.playlistGroupMemberFindMany.mockResolvedValue([
      { groupId: "group-1", playlist: { service: "SPOTIFY", servicePlaylistId: "sp-1" } },
      { groupId: "group-1", playlist: { service: "YOUTUBE", servicePlaylistId: "yt-1" } },
    ]);
    mocks.runSync.mockResolvedValue({ id: "job", status: "SUCCEEDED" });

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.runSync).toHaveBeenCalledTimes(2);
    expect(mocks.runSync).toHaveBeenNthCalledWith(1, "rule-sp");
    expect(mocks.runSync).toHaveBeenNthCalledWith(2, "rule-yt");
    expect(payload.skipped).toEqual([
      { syncRuleId: "rule-other", name: "Other rule", reason: "limit", detail: "CRON_MAX_RULES_PER_RUN=1" },
    ]);
    expect(payload.summary).toEqual({ due: 3, succeeded: 2, failed: 0, skipped: 1, staleMarked: 0 });
  });

  test("rejects invalid cron secret", async () => {
    process.env.CRON_SECRET = "expected";

    const response = await GET(request("wrong"));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Unauthorized" });
    expect(mocks.syncRuleFindMany).not.toHaveBeenCalled();
  });
});
