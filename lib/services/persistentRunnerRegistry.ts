import { PersistentRunner, type PersistentRunnerService } from "./persistentRunner";

// Process-wide registry of persistent runners. SyncEngine populates this at
// the start of a run (one runner per service it will actually need) and
// drains it in the finally block. While populated, runnerInvoker routes
// calls through these warm processes instead of spawning a fresh subprocess
// per command — saving ~15-20s of cloak browser cold start every call.
//
// Off by default — opt in with WORKER_PERSISTENT_RUNNERS=true so the change
// is reversible and the legacy spawn-per-call path is still available if
// the persistent loop misbehaves.

const runners = new Map<PersistentRunnerService, PersistentRunner>();

export function persistentRunnersEnabled(): boolean {
  return process.env.WORKER_PERSISTENT_RUNNERS === "true";
}

export function getPersistentRunner(service: PersistentRunnerService): PersistentRunner | undefined {
  return runners.get(service);
}

export async function ensurePersistentRunner(service: PersistentRunnerService): Promise<PersistentRunner> {
  const existing = runners.get(service);
  if (existing) return existing;
  const runner = await PersistentRunner.spawn(service);
  runners.set(service, runner);
  return runner;
}

export async function closeAllPersistentRunners(): Promise<void> {
  const entries = Array.from(runners.entries());
  runners.clear();
  await Promise.allSettled(entries.map(([, runner]) => runner.close()));
}
