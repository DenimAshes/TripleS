import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncJobUpdate: vi.fn().mockResolvedValue({}),
  browserJobUpdate: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    syncJob: {
      update: mocks.syncJobUpdate,
    },
    browserJob: {
      update: mocks.browserJobUpdate,
    },
  },
}));

import {
  bindCurrentBrowserJob,
  bindCurrentJob,
  listKnownBrowserJobChildPids,
  listKnownChildPids,
  registerChildPid,
  unregisterChildPid,
} from "../worker/childPidRegistry";

describe("childPidRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.syncJobUpdate.mockClear();
    mocks.browserJobUpdate.mockClear();
    bindCurrentJob(null);
    bindCurrentBrowserJob(null);
  });

  test("tracks sync and browser job pids independently", async () => {
    bindCurrentJob("sync-1");
    bindCurrentBrowserJob("browser-1");

    registerChildPid(101);

    expect(listKnownChildPids()).toEqual([101]);
    expect(listKnownBrowserJobChildPids()).toEqual([101]);

    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.syncJobUpdate).toHaveBeenCalledWith({
      where: { id: "sync-1" },
      data: { childPidsJson: JSON.stringify([101]) },
    });
    expect(mocks.browserJobUpdate).toHaveBeenCalledWith({
      where: { id: "browser-1" },
      data: { childPidsJson: JSON.stringify([101]) },
    });
  });

  test("does not persist sync pids when only a browser job is bound", async () => {
    bindCurrentBrowserJob("browser-2");

    registerChildPid(202);

    expect(listKnownChildPids()).toEqual([]);
    expect(listKnownBrowserJobChildPids()).toEqual([202]);

    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.syncJobUpdate).not.toHaveBeenCalled();
    expect(mocks.browserJobUpdate).toHaveBeenCalledWith({
      where: { id: "browser-2" },
      data: { childPidsJson: JSON.stringify([202]) },
    });
  });

  test("unregister removes a pid from both bound registries", async () => {
    bindCurrentJob("sync-3");
    bindCurrentBrowserJob("browser-3");
    registerChildPid(301);
    registerChildPid(302);

    unregisterChildPid(301);

    expect(listKnownChildPids()).toEqual([302]);
    expect(listKnownBrowserJobChildPids()).toEqual([302]);

    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.syncJobUpdate).toHaveBeenLastCalledWith({
      where: { id: "sync-3" },
      data: { childPidsJson: JSON.stringify([302]) },
    });
    expect(mocks.browserJobUpdate).toHaveBeenLastCalledWith({
      where: { id: "browser-3" },
      data: { childPidsJson: JSON.stringify([302]) },
    });
  });
});
