import { describe, expect, test } from "vitest";
import { runInActiveJob } from "../lib/jobs/activeJobContext";
import { runBrowserRunnerCli } from "../lib/services/browserRunnerCli";

describe("runBrowserRunnerCli cancellation", () => {
  test("kills the runner when the active job aborts", async () => {
    const abortController = new AbortController();
    const startedAt = Date.now();

    await expect(
      runInActiveJob({ jobId: "job-cancel", abortController }, async () => {
        const promise = runBrowserRunnerCli({
          serviceName: "test",
          script: "tests/fixtures/sleep-runner.ts",
          args: [],
          timeoutMs: 30_000,
        });
        setTimeout(() => abortController.abort(), 250).unref();
        return promise;
      }),
    ).rejects.toMatchObject({ name: "CancelledError" });

    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});
