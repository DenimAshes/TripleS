import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { registerChildPid, unregisterChildPid } from "@/worker/childPidRegistry";
import { sanitizeRunnerEnv } from "@/worker/runnerGuard";
import { createLogger } from "@/lib/utils/logger";

// PersistentRunner wraps a long-lived browser runner subprocess that exposes
// the same commands as the one-shot CLI runners but keeps the cloak browser
// session warm across calls. The cold start of a SoundCloud browser is
// ~15-20s; for a 10-track batch that's 150s+ of pure startup overhead per
// run. By keeping one persistent process per service for the duration of a
// sync run we collapse that to a single startup.
//
// Wire protocol (one JSON object per line, see worker/runners/_persistentLoop.ts):
//   stdin:  {"id": "<uuid>", "command": "<name>", "args": [...]}
//   stdout: {"id": "<uuid>", "ok": true,  "result": <json>}
//        or:{"id": "<uuid>", "ok": false, "error": "<message>"}
// Plus a one-time {"ready": true} marker from the child when the loop starts.
//
// Commands are serialized — only one in-flight at a time per runner — so the
// child never has to multiplex the browser session.

const log = createLogger("triples:persistent-runner");

export type PersistentRunnerService = "youtube" | "soundcloud";

type PendingRequest = {
  id: string;
  command: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const SCRIPT_BY_SERVICE: Record<PersistentRunnerService, string> = {
  youtube: "worker/runners/youtube.ts",
  soundcloud: "worker/runners/soundcloud.ts",
};

export class PersistentRunner {
  private constructor(
    public readonly service: PersistentRunnerService,
    private readonly child: ChildProcess,
  ) {}

  private queue: PendingRequest[] = [];
  private inFlight: PendingRequest | null = null;
  private buffer = "";
  private stderrTail = "";
  private closed = false;
  private exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | null = null;

  static async spawn(service: PersistentRunnerService, options?: { signal?: AbortSignal }): Promise<PersistentRunner> {
    const script = path.resolve(SCRIPT_BY_SERVICE[service]);
    const env = { ...sanitizeRunnerEnv(process.env), PERSISTENT_RUNNER: "true" } as unknown as NodeJS.ProcessEnv;
    const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const child = spawn(process.execPath, [tsxCli, script, "--persistent"], {
      cwd: process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcess;
    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new Error("persistent runner spawned without pipes");
    }
    const runner = new PersistentRunner(service, child);
    if (child.pid) registerChildPid(child.pid);
    runner.attachStreams();
    runner.exitPromise = new Promise((resolve) => {
      child.on("exit", (code, signal) => {
        if (child.pid) unregisterChildPid(child.pid);
        runner.handleExit(code, signal);
        resolve({ code, signal });
      });
    });
    await runner.waitReady(options?.signal);
    if (options?.signal?.aborted) {
      await runner.close();
      throw new Error("aborted");
    }
    return runner;
  }

  private attachStreams(): void {
    this.child.stdout!.setEncoding("utf8");
    this.child.stderr!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => this.handleStdout(chunk));
    this.child.stderr!.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2048);
    });
  }

  private async waitReady(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onReady = (line: string) => {
        try {
          const parsed = JSON.parse(line) as { ready?: boolean };
          if (parsed.ready) {
            this.child.stdout!.off("data", onData);
            resolve();
          }
        } catch {
          // ignore non-JSON noise before ready
        }
      };
      let acc = "";
      const onData = (chunk: string) => {
        acc += chunk;
        let nl: number;
        while ((nl = acc.indexOf("\n")) >= 0) {
          const line = acc.slice(0, nl);
          acc = acc.slice(nl + 1);
          onReady(line);
        }
      };
      this.child.stdout!.on("data", onData);
      this.child.on("exit", () => {
        this.child.stdout!.off("data", onData);
        reject(new Error(`runner exited before ready: ${this.stderrTail.slice(-512)}`));
      });
      if (signal) {
        const onAbort = () => {
          this.child.stdout!.off("data", onData);
          reject(new Error("aborted"));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let parsed: { id?: string; ok?: boolean; result?: unknown; error?: string };
      try {
        parsed = JSON.parse(line);
      } catch {
        // Treat non-JSON lines as runner stderr-like noise. Capture for context.
        this.stderrTail = (this.stderrTail + line + "\n").slice(-2048);
        continue;
      }
      const pending = this.inFlight && (!parsed.id || parsed.id === this.inFlight.id)
        ? this.inFlight
        : null;
      if (!pending) continue;
      this.inFlight = null;
      if (parsed.ok) {
        pending.resolve(parsed.result);
      } else {
        pending.reject(new Error(parsed.error || "persistent runner returned no payload"));
      }
      this.pump();
    }
  }

  private pump(): void {
    if (this.inFlight) return;
    const next = this.queue.shift();
    if (!next) return;
    this.inFlight = next;
    const line = JSON.stringify({ id: next.id, command: next.command, args: (next as unknown as { args: unknown[] }).args ?? [] });
    this.child.stdin!.write(line + "\n");
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.closed = true;
    const error = new Error(
      `persistent ${this.service} runner exited (code=${code}, signal=${signal ?? "none"}): ${this.stderrTail.slice(-512)}`,
    );
    log.warn("persistent runner exited", { service: this.service, code, signal });
    if (this.inFlight) {
      this.inFlight.reject(error);
      this.inFlight = null;
    }
    for (const pending of this.queue) pending.reject(error);
    this.queue = [];
  }

  invoke<T = unknown>(command: string, args: unknown[] = []): Promise<T> {
    if (this.closed) return Promise.reject(new Error(`persistent ${this.service} runner already closed`));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        id,
        command,
        resolve: (value) => resolve(value as T),
        reject,
      };
      (pending as unknown as { args: unknown[] }).args = args;
      this.queue.push(pending);
      this.pump();
    });
  }

  async close(timeoutMs = 5_000): Promise<void> {
    if (this.closed) return;
    this.child.stdin!.end();
    if (!this.exitPromise) return;
    await Promise.race([
      this.exitPromise.then(() => undefined),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          try {
            this.child.kill();
          } catch {}
          resolve();
        }, timeoutMs),
      ),
    ]);
  }
}
