import { describe, expect, test } from "vitest";
import {
  CancelledError,
  getActiveJob,
  getActiveJobAbortSignal,
  runInActiveJob,
  throwIfActiveJobAborted,
} from "../lib/jobs/activeJobContext";

describe("activeJobContext", () => {
  test("exposes job context within async execution", async () => {
    const abortController = new AbortController();

    await runInActiveJob({ jobId: "job-1", abortController }, async () => {
      await Promise.resolve();
      expect(getActiveJob()?.jobId).toBe("job-1");
      expect(getActiveJobAbortSignal()).toBe(abortController.signal);
    });

    expect(getActiveJob()).toBeUndefined();
  });

  test("throwIfActiveJobAborted throws CancelledError after abort", async () => {
    const abortController = new AbortController();

    await expect(
      runInActiveJob({ jobId: "job-2", abortController }, async () => {
        abortController.abort();
        throwIfActiveJobAborted();
      }),
    ).rejects.toBeInstanceOf(CancelledError);
  });
});
