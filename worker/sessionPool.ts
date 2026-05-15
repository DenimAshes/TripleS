import type { ServiceId } from "./config";
import { openWorkerBrowser, type WorkerBrowserSession } from "./browserSession";

const pool = new Map<ServiceId, WorkerBrowserSession>();

export function sessionReuseEnabled(): boolean {
  return process.env.WORKER_SESSION_REUSE !== "false";
}

export async function acquireSession(service: ServiceId): Promise<WorkerBrowserSession> {
  const existing = pool.get(service);
  if (existing) return existing;
  const session = await openWorkerBrowser({ service });
  pool.set(service, session);
  return session;
}

export async function releaseAllSessions(): Promise<void> {
  const sessions = Array.from(pool.values());
  pool.clear();
  await Promise.allSettled(sessions.map((s) => s.close()));
}

export async function evictSession(service: ServiceId): Promise<void> {
  const existing = pool.get(service);
  if (!existing) return;
  pool.delete(service);
  await existing.close().catch(() => {});
}
