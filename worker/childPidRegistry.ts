import { spawn } from "node:child_process";
import { prisma } from "@/lib/db/prisma";

let currentJobId: string | null = null;
let currentBrowserJobId: string | null = null;
const syncPids = new Set<number>();
const browserJobPids = new Set<number>();
let persistSyncDebounce: ReturnType<typeof setTimeout> | null = null;
let persistBrowserJobDebounce: ReturnType<typeof setTimeout> | null = null;

export function bindCurrentJob(jobId: string | null): void {
  currentJobId = jobId;
  syncPids.clear();
}

export function bindCurrentBrowserJob(jobId: string | null): void {
  currentBrowserJobId = jobId;
  browserJobPids.clear();
}

export function registerChildPid(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (currentJobId) {
    syncPids.add(pid);
    scheduleSyncPersist();
  }
  if (currentBrowserJobId) {
    browserJobPids.add(pid);
    scheduleBrowserJobPersist();
  }
}

export function unregisterChildPid(pid: number): void {
  if (syncPids.delete(pid)) scheduleSyncPersist();
  if (browserJobPids.delete(pid)) scheduleBrowserJobPersist();
}

function scheduleSyncPersist(): void {
  if (!currentJobId) return;
  if (persistSyncDebounce) clearTimeout(persistSyncDebounce);
  persistSyncDebounce = setTimeout(() => {
    void persistSyncNow();
  }, 250);
  (persistSyncDebounce as { unref?: () => void }).unref?.();
}

function scheduleBrowserJobPersist(): void {
  if (!currentBrowserJobId) return;
  if (persistBrowserJobDebounce) clearTimeout(persistBrowserJobDebounce);
  persistBrowserJobDebounce = setTimeout(() => {
    void persistBrowserJobNow();
  }, 250);
  (persistBrowserJobDebounce as { unref?: () => void }).unref?.();
}

async function persistSyncNow(): Promise<void> {
  if (!currentJobId) return;
  const snapshot = Array.from(syncPids);
  try {
    await prisma.syncJob.update({
      where: { id: currentJobId },
      data: { childPidsJson: JSON.stringify(snapshot) },
    });
  } catch {}
}

async function persistBrowserJobNow(): Promise<void> {
  if (!currentBrowserJobId) return;
  const snapshot = Array.from(browserJobPids);
  try {
    await prisma.browserJob.update({
      where: { id: currentBrowserJobId },
      data: { childPidsJson: JSON.stringify(snapshot) },
    });
  } catch {}
}

export function listKnownChildPids(): number[] {
  return Array.from(syncPids);
}

export function listKnownBrowserJobChildPids(): number[] {
  return Array.from(browserJobPids);
}

export function killChildPids(pidList: number[]): { killed: number[]; failed: number[] } {
  const killed: number[] = [];
  const failed: number[] = [];
  for (const pid of pidList) {
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (process.platform === "win32") {
      try {
        const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.unref();
        killed.push(pid);
      } catch {
        failed.push(pid);
      }
    } else {
      try {
        process.kill(-pid, "SIGKILL");
        killed.push(pid);
      } catch {
        try {
          process.kill(pid, "SIGKILL");
          killed.push(pid);
        } catch {
          failed.push(pid);
        }
      }
    }
  }
  return { killed, failed };
}
