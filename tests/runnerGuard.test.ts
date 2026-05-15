import { describe, expect, test } from "vitest";
import { allowsDirectRunnerImport, assertRunnerCli, detectsNextServer, isRunnerCli, sanitizeRunnerEnv } from "../worker/runnerGuard";

describe("runnerGuard", () => {
  test("detects runner CLI mode", () => {
    expect(isRunnerCli({})).toBe(false);
    expect(isRunnerCli({ WORKER_RUNNER_CLI: "false" })).toBe(false);
    expect(isRunnerCli({ WORKER_RUNNER_CLI: "true" })).toBe(true);
  });

  test("detects direct import override", () => {
    expect(allowsDirectRunnerImport({})).toBe(false);
    expect(allowsDirectRunnerImport({ ALLOW_DIRECT_WORKER_RUNNER_IMPORT: "true" })).toBe(true);
  });

  test("detects Next server markers", () => {
    expect(detectsNextServer({})).toBe(false);
    expect(detectsNextServer({ NEXT_RUNTIME: "nodejs" })).toBe(true);
    expect(detectsNextServer({ NEXT_PHASE: "phase-production-build" })).toBe(true);
  });

  test("throws for direct Next imports without override", () => {
    expect(() => assertRunnerCli({ env: { NEXT_RUNTIME: "nodejs" } })).toThrow(/runnerGuard/);
  });

  test("allows runner CLI and explicit direct import override", () => {
    expect(() => assertRunnerCli({ env: { NEXT_RUNTIME: "nodejs", WORKER_RUNNER_CLI: "true" } })).not.toThrow();
    expect(() => assertRunnerCli({ env: { NEXT_RUNTIME: "nodejs", ALLOW_DIRECT_WORKER_RUNNER_IMPORT: "true" } })).not.toThrow();
  });

  test("sanitizeRunnerEnv strips Next markers and sets CLI flag", () => {
    const parent = {
      NEXT_RUNTIME: "nodejs",
      NEXT_PHASE: "phase-production-server",
      KEEP_ME: "1",
      WORKER_RUNNER_CLI: "false",
    };
    const sanitized = sanitizeRunnerEnv(parent);
    expect(sanitized.NEXT_RUNTIME).toBeUndefined();
    expect(sanitized.NEXT_PHASE).toBeUndefined();
    expect(sanitized.WORKER_RUNNER_CLI).toBe("true");
    expect(sanitized.KEEP_ME).toBe("1");
    expect(parent.NEXT_RUNTIME).toBe("nodejs");
    expect(parent.WORKER_RUNNER_CLI).toBe("false");
  });
});
