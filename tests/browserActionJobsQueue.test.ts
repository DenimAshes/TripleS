import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  syncRuleFindFirst: vi.fn(),
  killChildPids: vi.fn(() => ({ killed: [], failed: [] })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    browserJob: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      create: mocks.create,
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    syncRule: {
      findFirst: mocks.syncRuleFindFirst,
    },
  },
}));

vi.mock("@/lib/services/adapterFactory", () => ({ serviceKey: (service: string) => service.toLowerCase() }));
vi.mock("@/lib/services/playlistTracksStore", () => ({ syncPlaylistTracksToDb: vi.fn() }));
vi.mock("@/lib/services/playlistGroupActions", () => ({ connectPlaylistGroup: vi.fn() }));
const syncMocks = vi.hoisted(() => ({
  runSync: vi.fn(),
}));

vi.mock("@/lib/sync/syncEngine", () => ({ runSync: syncMocks.runSync }));
vi.mock("@/worker/childPidRegistry", () => ({
  bindCurrentBrowserJob: vi.fn(),
  killChildPids: mocks.killChildPids,
  listKnownBrowserJobChildPids: vi.fn(() => []),
}));

import {
  claimQueuedBrowserActionJob,
  reclaimStaleBrowserActionJobs,
  runClaimedBrowserActionJob,
  startBrowserActionJob,
} from "../lib/services/browserActionJobs";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    userId: "user-1",
    type: "sync.run",
    status: "queued",
    inputJson: JSON.stringify({ syncRuleId: "rule-1" }),
    resultJson: null,
    errorCode: null,
    errorMessage: null,
    errorDetailsJson: null,
    currentStep: "Queued",
    claimedAt: null,
    workerId: null,
    attempts: 0,
    startedAt: new Date("2026-05-15T00:00:00.000Z"),
    finishedAt: null,
    createdAt: new Date("2026-05-15T00:00:00.000Z"),
    updatedAt: new Date("2026-05-15T00:00:00.000Z"),
    childPidsJson: null,
    ...overrides,
  };
}

describe("browser action job queue", () => {
  beforeEach(() => {
    process.env.BROWSER_JOB_EXECUTION_MODE = "worker";
    mocks.findFirst.mockReset();
    mocks.findMany.mockReset();
    mocks.create.mockReset();
    mocks.updateMany.mockReset();
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockReset();
    mocks.update.mockReset();
    mocks.syncRuleFindFirst.mockReset();
    mocks.killChildPids.mockClear();
    syncMocks.runSync.mockReset();
  });

  afterEach(() => {
    delete process.env.BROWSER_JOB_EXECUTION_MODE;
  });

  test("startBrowserActionJob creates a queued job without immediately marking it running in worker mode", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue(row());

    const job = await startBrowserActionJob("user-1", "sync.run", { syncRuleId: "rule-1" });

    expect(job.status).toBe("queued");
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "sync.run",
        status: "queued",
        inputJson: JSON.stringify({ syncRuleId: "rule-1" }),
        currentStep: "Queued",
      },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("claimQueuedBrowserActionJob atomically claims the oldest queued job", async () => {
    mocks.findFirst.mockResolvedValue(row());
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(row({ status: "running", currentStep: "Claimed by worker" }));

    const job = await claimQueuedBrowserActionJob();

    expect(job?.status).toBe("running");
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "queued" },
      data: {
        status: "running",
        currentStep: "Claimed by worker",
        claimedAt: expect.any(Date),
        workerId: null,
        attempts: { increment: 1 },
      },
    });
  });

  test("claimQueuedBrowserActionJob records worker claim metadata", async () => {
    mocks.findFirst.mockResolvedValue(row());
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(
      row({ status: "running", currentStep: "Claimed by worker-a", workerId: "worker-a", attempts: 1, claimedAt: new Date() }),
    );

    const job = await claimQueuedBrowserActionJob("worker-a");

    expect(job?.workerId).toBe("worker-a");
    expect(job?.attempts).toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "queued" },
      data: {
        status: "running",
        currentStep: "Claimed by worker-a",
        claimedAt: expect.any(Date),
        workerId: "worker-a",
        attempts: { increment: 1 },
      },
    });
  });

  test("reclaimStaleBrowserActionJobs fails stale running jobs and kills tracked child pids", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T01:00:00.000Z"));
    mocks.findMany.mockResolvedValue([
      {
        id: "job-stale",
        childPidsJson: JSON.stringify([111, 222]),
      },
    ]);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const count = await reclaimStaleBrowserActionJobs(30 * 60_000);

    expect(count).toBe(1);
    expect(mocks.killChildPids).toHaveBeenCalledWith([111, 222]);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        status: "running",
        updatedAt: { lt: new Date("2026-05-15T00:30:00.000Z") },
      },
      select: { id: true, childPidsJson: true },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["job-stale"] },
        status: "running",
        updatedAt: { lt: new Date("2026-05-15T00:30:00.000Z") },
      },
      data: expect.objectContaining({
        status: "failed",
        errorCode: "RUNNER_TIMEOUT",
        childPidsJson: null,
        finishedAt: expect.any(Date),
      }),
    });
    vi.useRealTimers();
  });

  test("reclaimStaleBrowserActionJobs is a no-op when there are no stale jobs", async () => {
    mocks.findMany.mockResolvedValue([]);

    const count = await reclaimStaleBrowserActionJobs(30 * 60_000);

    expect(count).toBe(0);
    expect(mocks.killChildPids).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  test("runClaimedBrowserActionJob heartbeats while a job is running", async () => {
    vi.useFakeTimers();
    mocks.findUnique.mockResolvedValue({ status: "running", childPidsJson: null });
    mocks.syncRuleFindFirst.mockResolvedValue({ id: "rule-1" });
    let finishSync!: () => void;
    syncMocks.runSync.mockReturnValue(new Promise((resolve) => {
      finishSync = () => resolve({ id: "sync-job-1", status: "SUCCEEDED" });
    }));

    const running = row({ status: "running", currentStep: "Claimed by worker" });
    const promise = runClaimedBrowserActionJob({
      id: "job-1",
      userId: "user-1",
      type: "sync.run",
      status: "running",
      input: { syncRuleId: "rule-1" },
      result: null,
      error: null,
      errorCode: null,
      errorDetails: null,
      currentStep: "Claimed by worker",
      claimedAt: null,
      workerId: null,
      attempts: 0,
      startedAt: running.startedAt,
      finishedAt: null,
    });

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: { updatedAt: expect.any(Date) },
    });

    finishSync();
    await promise;
    vi.useRealTimers();
  });
});
