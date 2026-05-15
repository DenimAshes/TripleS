import { spawn } from "node:child_process";
import path from "node:path";
import { CancelledError, getActiveJobAbortSignal } from "@/lib/jobs/activeJobContext";
import { registerChildPid, unregisterChildPid } from "@/worker/childPidRegistry";
import { sanitizeRunnerEnv } from "@/worker/runnerGuard";

type RunBrowserRunnerOptions = {
  serviceName: string;
  script: string;
  args: string[];
  timeoutMs: number;
  maxBuffer?: number;
  signal?: AbortSignal;
};

type RunnerTelemetry = {
  service: string;
  script: string;
  pid: number | null;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  killedTree: boolean;
  reason: "exit" | "timeout" | "buffer-overflow" | "spawn-error" | "cancelled";
  stderrTail: string;
};

function tail(text: string, max = 1024): string {
  if (text.length <= max) return text;
  return text.slice(text.length - max);
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
}

function emit(telemetry: RunnerTelemetry): void {
  try {
    console.log(`[browser-runner] ${JSON.stringify(telemetry)}`);
  } catch {}
}

export function runBrowserRunnerCli({
  serviceName,
  script,
  args,
  timeoutMs,
  maxBuffer = 10 * 1024 * 1024,
  signal,
}: RunBrowserRunnerOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const abortSignal = signal ?? getActiveJobAbortSignal();
    const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const startedAt = Date.now();
    const child = spawn(process.execPath, [tsxCli, script, ...args], {
      cwd: process.cwd(),
      env: sanitizeRunnerEnv() as NodeJS.ProcessEnv,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (typeof child.pid === "number") {
      registerChildPid(child.pid);
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let killedTree = false;

    const finalize = (
      reason: RunnerTelemetry["reason"],
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      error?: Error,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      abortSignal?.removeEventListener("abort", onAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (typeof child.pid === "number") {
        unregisterChildPid(child.pid);
      }
      emit({
        service: serviceName,
        script,
        pid: child.pid ?? null,
        durationMs: Date.now() - startedAt,
        exitCode,
        signal,
        killedTree,
        reason,
        stderrTail: tail(stderr.trim()),
      });
      if (error) reject(error);
      else resolve(stdout);
    };

    const timeoutTimer = setTimeout(() => {
      if (child.pid) {
        killedTree = true;
        killProcessTree(child.pid);
      }
      child.kill("SIGKILL");
      finalize("timeout", null, null, new Error(`${serviceName} browser runner timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onAbort = () => {
      if (child.pid) {
        killedTree = true;
        killProcessTree(child.pid);
      }
      child.kill("SIGKILL");
      finalize("cancelled", null, null, new CancelledError(`${serviceName} browser runner cancelled`));
    };
    if (abortSignal?.aborted) {
      onAbort();
    } else {
      abortSignal?.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > maxBuffer) {
        if (child.pid) {
          killedTree = true;
          killProcessTree(child.pid);
        }
        finalize("buffer-overflow", null, null, new Error(`${serviceName} browser runner exceeded stdout buffer limit`));
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > maxBuffer) {
        if (child.pid) {
          killedTree = true;
          killProcessTree(child.pid);
        }
        finalize("buffer-overflow", null, null, new Error(`${serviceName} browser runner exceeded stderr buffer limit`));
      }
    });

    child.on("error", (error) => finalize("spawn-error", null, null, error));
    child.on("close", (code, signal) => {
      if (code === 0) {
        finalize("exit", code, signal);
        return;
      }
      const status = signal ? `signal ${signal}` : `exit code ${code}`;
      finalize(
        "exit",
        code,
        signal,
        new Error(`${serviceName} browser runner failed with ${status}${stderr.trim() ? `: ${tail(stderr.trim())}` : ""}`),
      );
    });
  });
}
