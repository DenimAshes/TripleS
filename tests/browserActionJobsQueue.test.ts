import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  syncRuleFindFirst: vi.fn(),
  syncRuleFindMany: vi.fn(),
  playlistFindUnique: vi.fn(),
  playlistGroupMemberFindUnique: vi.fn(),
  playlistGroupMemberFindMany: vi.fn(),
  playlistTrackStateFindMany: vi.fn(),
  manualMatchCandidateCount: vi.fn(),
  syncPlaylistTracksToDb: vi.fn(),
  connectPlaylistGroup: vi.fn(),
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
      findMany: mocks.syncRuleFindMany,
    },
    playlist: {
      findUnique: mocks.playlistFindUnique,
    },
    playlistGroupMember: {
      findUnique: mocks.playlistGroupMemberFindUnique,
      findMany: mocks.playlistGroupMemberFindMany,
    },
    playlistTrackState: {
      findMany: mocks.playlistTrackStateFindMany,
    },
    manualMatchCandidate: {
      count: mocks.manualMatchCandidateCount,
    },
  },
}));

vi.mock("@/lib/services/adapterFactory", () => ({ serviceKey: (service: string) => service.toLowerCase() }));
vi.mock("@/lib/services/playlistTracksStore", () => ({ syncPlaylistTracksToDb: mocks.syncPlaylistTracksToDb }));
vi.mock("@/lib/services/playlistGroupActions", () => ({ connectPlaylistGroup: mocks.connectPlaylistGroup }));
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
    mocks.syncRuleFindMany.mockReset();
    mocks.playlistFindUnique.mockReset();
    mocks.playlistGroupMemberFindUnique.mockReset();
    mocks.playlistGroupMemberFindMany.mockReset();
    mocks.playlistTrackStateFindMany.mockReset();
    mocks.manualMatchCandidateCount.mockReset();
    mocks.syncPlaylistTracksToDb.mockReset();
    mocks.connectPlaylistGroup.mockReset();
    mocks.killChildPids.mockClear();
    syncMocks.runSync.mockReset();
    mocks.playlistTrackStateFindMany.mockResolvedValue([]);
    mocks.manualMatchCandidateCount.mockResolvedValue(0);
    mocks.playlistGroupMemberFindUnique.mockResolvedValue(null);
    mocks.playlistGroupMemberFindMany.mockResolvedValue([]);
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

  test("reclaimStaleBrowserActionJobs fails stale running jobs that exhausted retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T01:00:00.000Z"));
    mocks.findMany.mockResolvedValue([
      {
        id: "job-stale",
        childPidsJson: JSON.stringify([111, 222]),
        attempts: 3,
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
      select: { id: true, childPidsJson: true, attempts: true },
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

  test("reclaimStaleBrowserActionJobs re-queues stale jobs that still have retries left", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T01:00:00.000Z"));
    mocks.findMany.mockResolvedValue([
      {
        id: "job-stale-retry",
        childPidsJson: JSON.stringify([333]),
        attempts: 1,
      },
    ]);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const count = await reclaimStaleBrowserActionJobs(30 * 60_000);

    expect(count).toBe(1);
    expect(mocks.killChildPids).toHaveBeenCalledWith([333]);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["job-stale-retry"] },
        status: "running",
        updatedAt: { lt: new Date("2026-05-15T00:30:00.000Z") },
      },
      data: expect.objectContaining({
        status: "queued",
        claimedAt: null,
        workerId: null,
        childPidsJson: null,
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

  test("runClaimedBrowserActionJob fails sync.run jobs without syncRuleId", async () => {
    mocks.findUnique.mockResolvedValue({ status: "running", childPidsJson: null });

    await runClaimedBrowserActionJob({
      id: "job-1",
      userId: "user-1",
      type: "sync.run",
      status: "running",
      input: {},
      result: null,
      error: null,
      errorCode: null,
      errorDetails: null,
      currentStep: "Claimed by worker",
      claimedAt: null,
      workerId: null,
      attempts: 0,
      startedAt: new Date("2026-05-15T00:00:00.000Z"),
      finishedAt: null,
    });

    expect(mocks.syncRuleFindFirst).not.toHaveBeenCalled();
    expect(syncMocks.runSync).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "syncRuleId is required",
        currentStep: "Failed",
        finishedAt: expect.any(Date),
      }),
    });
  });

  test("playlistGroup.connect runs an initial merge across enabled group sources by default", async () => {
    mocks.findUnique.mockResolvedValue({ status: "running", childPidsJson: null });
    mocks.connectPlaylistGroup.mockResolvedValue({ id: "group-1", members: [] });
    mocks.playlistFindUnique.mockResolvedValue({
      id: "playlist-source",
      userId: "user-1",
      service: "SPOTIFY",
      servicePlaylistId: "sp-source",
    });
    mocks.playlistGroupMemberFindUnique.mockResolvedValue({ groupId: "group-1" });
    mocks.playlistGroupMemberFindMany.mockResolvedValue([
      {
        playlist: {
          id: "playlist-source",
          userId: "user-1",
          service: "SPOTIFY",
          servicePlaylistId: "sp-source",
        },
      },
      {
        playlist: {
          id: "playlist-dest",
          userId: "user-1",
          service: "YOUTUBE",
          servicePlaylistId: "yt-dest",
        },
      },
    ]);
    mocks.syncPlaylistTracksToDb.mockResolvedValue({ active: 10, expected: 10 });
    mocks.syncRuleFindMany.mockResolvedValue([
      { id: "rule-source", sourceService: "SPOTIFY", sourcePlaylistId: "sp-source" },
      { id: "rule-youtube", sourceService: "YOUTUBE", sourcePlaylistId: "yt-dest" },
    ]);
    syncMocks.runSync
      .mockResolvedValueOnce({ id: "sync-job-1", status: "SUCCEEDED" })
      .mockResolvedValueOnce({ id: "sync-job-2", status: "SUCCEEDED" });
    mocks.playlistTrackStateFindMany.mockResolvedValue([{ serviceTrackId: "track-1" }, { serviceTrackId: "track-2" }]);
    mocks.manualMatchCandidateCount.mockResolvedValue(2);

    await runClaimedBrowserActionJob({
      id: "job-1",
      userId: "user-1",
      type: "playlistGroup.connect",
      status: "running",
      input: { sourcePlaylistId: "playlist-source", destinationPlaylistIds: ["playlist-dest"] },
      result: null,
      error: null,
      errorCode: null,
      errorDetails: null,
      currentStep: "Claimed by worker",
      claimedAt: null,
      workerId: null,
      attempts: 0,
      startedAt: new Date("2026-05-15T00:00:00.000Z"),
      finishedAt: null,
    });

    expect(mocks.connectPlaylistGroup).toHaveBeenCalledWith("user-1", {
      sourcePlaylistId: "playlist-source",
      destinationPlaylistIds: ["playlist-dest"],
    });
    expect(mocks.syncPlaylistTracksToDb).toHaveBeenNthCalledWith(1, "user-1", "spotify", "sp-source", expect.any(Function));
    expect(mocks.syncPlaylistTracksToDb).toHaveBeenNthCalledWith(2, "user-1", "youtube", "yt-dest", expect.any(Function));
    expect(mocks.syncRuleFindMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        isEnabled: true,
        direction: "TWO_WAY",
        OR: [
          { sourceService: "SPOTIFY", sourcePlaylistId: "sp-source" },
          { sourceService: "YOUTUBE", sourcePlaylistId: "yt-dest" },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    expect(syncMocks.runSync).toHaveBeenCalledWith("rule-source");
    expect(syncMocks.runSync).toHaveBeenCalledWith("rule-youtube");
    expect(mocks.playlistTrackStateFindMany).toHaveBeenCalledWith({
      where: { playlistId: { in: ["playlist-source", "playlist-dest"] }, removedAt: null },
      select: { serviceTrackId: true },
    });
    expect(mocks.manualMatchCandidateCount).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: "PENDING",
        sourceServiceTrackId: { in: ["track-1", "track-2"] },
      },
    });
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "succeeded",
        resultJson: JSON.stringify({
          group: { id: "group-1", members: [] },
          initialSync: {
            sourceRefreshes: [
              { playlistId: "playlist-source", service: "SPOTIFY", result: { active: 10, expected: 10 } },
              { playlistId: "playlist-dest", service: "YOUTUBE", result: { active: 10, expected: 10 } },
            ],
            sourceErrors: [],
            syncJobs: [
              { id: "sync-job-1", status: "SUCCEEDED" },
              { id: "sync-job-2", status: "SUCCEEDED" },
            ],
            syncErrors: [],
            pendingReviewCount: 2,
          },
        }),
        currentStep: "Finished",
        finishedAt: expect.any(Date),
      }),
    });
  });

  test("playlistGroup.connect keeps initial merge going after one source sync fails", async () => {
    mocks.findUnique.mockResolvedValue({ status: "running", childPidsJson: null });
    mocks.connectPlaylistGroup.mockResolvedValue({ id: "group-1", members: [] });
    mocks.playlistFindUnique.mockResolvedValue({
      id: "playlist-source",
      userId: "user-1",
      service: "SPOTIFY",
      servicePlaylistId: "sp-source",
    });
    mocks.playlistGroupMemberFindUnique.mockResolvedValue({ groupId: "group-1" });
    mocks.playlistGroupMemberFindMany.mockResolvedValue([
      {
        playlist: {
          id: "playlist-source",
          userId: "user-1",
          service: "SPOTIFY",
          servicePlaylistId: "sp-source",
        },
      },
      {
        playlist: {
          id: "playlist-dest",
          userId: "user-1",
          service: "YOUTUBE",
          servicePlaylistId: "yt-dest",
        },
      },
    ]);
    mocks.syncPlaylistTracksToDb.mockResolvedValue({ active: 10, expected: 10 });
    mocks.syncRuleFindMany.mockResolvedValue([
      { id: "rule-source", sourceService: "SPOTIFY", sourcePlaylistId: "sp-source" },
      { id: "rule-youtube", sourceService: "YOUTUBE", sourcePlaylistId: "yt-dest" },
    ]);
    syncMocks.runSync
      .mockRejectedValueOnce(new Error("Spotify temporarily failed"))
      .mockResolvedValueOnce({ id: "sync-job-2", status: "SUCCEEDED" });

    await runClaimedBrowserActionJob({
      id: "job-1",
      userId: "user-1",
      type: "playlistGroup.connect",
      status: "running",
      input: { sourcePlaylistId: "playlist-source", destinationPlaylistIds: ["playlist-dest"] },
      result: null,
      error: null,
      errorCode: null,
      errorDetails: null,
      currentStep: "Claimed by worker",
      claimedAt: null,
      workerId: null,
      attempts: 0,
      startedAt: new Date("2026-05-15T00:00:00.000Z"),
      finishedAt: null,
    });

    expect(syncMocks.runSync).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "succeeded",
        resultJson: JSON.stringify({
          group: { id: "group-1", members: [] },
          initialSync: {
            sourceRefreshes: [
              { playlistId: "playlist-source", service: "SPOTIFY", result: { active: 10, expected: 10 } },
              { playlistId: "playlist-dest", service: "YOUTUBE", result: { active: 10, expected: 10 } },
            ],
            sourceErrors: [],
            syncJobs: [{ id: "sync-job-2", status: "SUCCEEDED" }],
            syncErrors: [
              {
                ruleId: "rule-source",
                service: "SPOTIFY",
                phase: "sync",
                error: "Spotify temporarily failed",
              },
            ],
            pendingReviewCount: 0,
          },
        }),
      }),
    });
  });

  test("playlistGroup.connect skips sync for a source whose refresh failed", async () => {
    mocks.findUnique.mockResolvedValue({ status: "running", childPidsJson: null });
    mocks.connectPlaylistGroup.mockResolvedValue({ id: "group-1", members: [] });
    mocks.playlistFindUnique.mockResolvedValue({
      id: "playlist-source",
      userId: "user-1",
      service: "SPOTIFY",
      servicePlaylistId: "sp-source",
    });
    mocks.playlistGroupMemberFindUnique.mockResolvedValue({ groupId: "group-1" });
    mocks.playlistGroupMemberFindMany.mockResolvedValue([
      {
        playlist: {
          id: "playlist-source",
          userId: "user-1",
          service: "SPOTIFY",
          servicePlaylistId: "sp-source",
        },
      },
      {
        playlist: {
          id: "playlist-dest",
          userId: "user-1",
          service: "YOUTUBE",
          servicePlaylistId: "yt-dest",
        },
      },
    ]);
    mocks.syncPlaylistTracksToDb
      .mockRejectedValueOnce(new Error("Spotify read failed"))
      .mockResolvedValueOnce({ active: 8, expected: 8 });
    mocks.syncRuleFindMany.mockResolvedValue([
      { id: "rule-source", sourceService: "SPOTIFY", sourcePlaylistId: "sp-source" },
      { id: "rule-youtube", sourceService: "YOUTUBE", sourcePlaylistId: "yt-dest" },
    ]);
    syncMocks.runSync.mockResolvedValue({ id: "sync-job-2", status: "SUCCEEDED" });

    await runClaimedBrowserActionJob({
      id: "job-1",
      userId: "user-1",
      type: "playlistGroup.connect",
      status: "running",
      input: { sourcePlaylistId: "playlist-source", destinationPlaylistIds: ["playlist-dest"] },
      result: null,
      error: null,
      errorCode: null,
      errorDetails: null,
      currentStep: "Claimed by worker",
      claimedAt: null,
      workerId: null,
      attempts: 0,
      startedAt: new Date("2026-05-15T00:00:00.000Z"),
      finishedAt: null,
    });

    expect(syncMocks.runSync).toHaveBeenCalledTimes(1);
    expect(syncMocks.runSync).toHaveBeenCalledWith("rule-youtube");
    expect(syncMocks.runSync).not.toHaveBeenCalledWith("rule-source");
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "succeeded",
        resultJson: JSON.stringify({
          group: { id: "group-1", members: [] },
          initialSync: {
            sourceRefreshes: [
              { playlistId: "playlist-dest", service: "YOUTUBE", result: { active: 8, expected: 8 } },
            ],
            sourceErrors: [
              {
                playlistId: "playlist-source",
                service: "SPOTIFY",
                phase: "refresh",
                error: "Spotify read failed",
              },
            ],
            syncJobs: [{ id: "sync-job-2", status: "SUCCEEDED" }],
            syncErrors: [],
            pendingReviewCount: 0,
          },
        }),
      }),
    });
  });

  test("playlistGroup.connect can skip initial sync", async () => {
    mocks.findUnique.mockResolvedValue({ status: "running", childPidsJson: null });
    mocks.connectPlaylistGroup.mockResolvedValue({ id: "group-1", members: [] });

    await runClaimedBrowserActionJob({
      id: "job-1",
      userId: "user-1",
      type: "playlistGroup.connect",
      status: "running",
      input: { sourcePlaylistId: "playlist-source", destinationPlaylistIds: ["playlist-dest"], runInitialSync: false },
      result: null,
      error: null,
      errorCode: null,
      errorDetails: null,
      currentStep: "Claimed by worker",
      claimedAt: null,
      workerId: null,
      attempts: 0,
      startedAt: new Date("2026-05-15T00:00:00.000Z"),
      finishedAt: null,
    });

    expect(mocks.syncPlaylistTracksToDb).not.toHaveBeenCalled();
    expect(syncMocks.runSync).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "succeeded",
        resultJson: JSON.stringify({ group: { id: "group-1", members: [] }, initialSync: null }),
      }),
    });
  });
});
