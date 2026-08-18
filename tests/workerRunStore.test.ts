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

import { failWorkerRun, finishWorkerRun, startWorkerRun, workerRunStatusFor } from "../lib/services/workerRunStore";

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
test("keeps mixed runs partial and records no error message", async () => {
    await finishWorkerRun("run-1", { due: 3, runnable: 3, selected: 3, ran: 2, failed: 1, skipped: 0 });

    const call = mocks.update.mock.calls[0][0];
    expect(call.data).toMatchObject({ status: "PARTIAL_SUCCESS", ran: 2, failed: 1 });
    expect(call.data.errorMessage).toBeNull();
  });

  test("marks a run where nothing completed as FAILED so the dashboard warns", async () => {
    await finishWorkerRun("run-1", { due: 4, runnable: 4, selected: 2, ran: 0, failed: 2, skipped: 0 });

    const call = mocks.update.mock.calls[0][0];
    expect(call.data).toMatchObject({ status: "FAILED", ran: 0, failed: 2 });
    expect(call.data.errorMessage).toBe("Every selected rule failed (2/2); no rule completed.");
  });
});

describe("workerRunStatusFor", () => {
  test("is SUCCESS when nothing failed", () => {
    expect(workerRunStatusFor({ ran: 3, failed: 0 })).toBe("SUCCESS");
    expect(workerRunStatusFor({ ran: 0, failed: 0 })).toBe("SUCCESS");
  });

  test("is PARTIAL_SUCCESS when some rules completed alongside failures", () => {
    expect(workerRunStatusFor({ ran: 1, failed: 1 })).toBe("PARTIAL_SUCCESS");
  });

  test("is FAILED when every rule failed", () => {
    expect(workerRunStatusFor({ ran: 0, failed: 2 })).toBe("FAILED");
  });
});
