import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workerRun: {
      create: mocks.create,
      update: mocks.update,
    },
  },
}));

import { failWorkerRun, finishWorkerRun, startWorkerRun } from "../lib/services/workerRunStore";

describe("worker run store", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.update.mockReset();
    mocks.create.mockResolvedValue({ id: "run-1" });
    mocks.update.mockResolvedValue({ id: "run-1" });
  });

  test("starts a running worker row", async () => {
    await startWorkerRun("sync-worker");

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        worker: "sync-worker",
        status: "RUNNING",
      },
      select: { id: true },
    });
  });

  test("finishes successful runs with capped skipped reasons", async () => {
    await finishWorkerRun("run-1", {
      due: 10,
      runnable: 8,
      selected: 4,
      ran: 4,
      failed: 0,
      skipped: 14,
      skippedReasons: Array.from({ length: 14 }, (_, index) => ({
        ruleId: `rule-${index}`,
        name: `Rule ${index}`,
        reason: "limit",
      })),
    });

    const call = mocks.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "run-1" });
    expect(call.data).toMatchObject({
      status: "SUCCESS",
      due: 10,
      runnable: 8,
      selected: 4,
      ran: 4,
      failed: 0,
      skipped: 14,
    });
    expect(JSON.parse(call.data.skippedJson)).toHaveLength(12);
  });

  test("marks failed runs with partial summary and error message", async () => {
    await failWorkerRun("run-1", new Error("boom"), {
      due: 2,
      runnable: 1,
      selected: 1,
      ran: 0,
      failed: 1,
      skipped: 1,
      skippedReasons: [{ reason: "preflight", detail: "missing session" }],
    });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "FAILED",
        due: 2,
        runnable: 1,
        selected: 1,
        ran: 0,
        failed: 1,
        skipped: 1,
        errorMessage: "boom",
        skippedJson: JSON.stringify([{ reason: "preflight", detail: "missing session" }]),
      }),
    });
  });
});
