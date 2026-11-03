"use client";

export type BrowserJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type BrowserJob = {
  id: string;
  type: string;
  status: BrowserJobStatus;
  currentStep: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  errorCode: string | null;
  errorDetails: {
    recommendedAction?: string;
    activeTracks?: number;
    expectedTracks?: number;
  } | null;
  result: {
    initialSync?: {
      pendingReviewCount?: number;
      syncJobs?: Array<{
        statsJson?: string;
      }>;
      sourceErrors?: Array<{ service?: string; error?: string }>;
      syncErrors?: Array<{ service?: string; error?: string }>;
    } | null;
  } | null;
};

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const id = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(id);
      signal?.removeEventListener("abort", abort);
      reject(abortError(signal!));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload as T;
}

export async function startBrowserJob(type: string, input: unknown): Promise<BrowserJob> {
  const response = await fetch("/api/browser-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, input }),
  });
  return (await readJson<{ job: BrowserJob }>(response)).job;
}

export async function pollBrowserJob(jobId: string, onUpdate: (job: BrowserJob) => void, signal?: AbortSignal): Promise<BrowserJob> {
  if (signal?.aborted) throw abortError(signal);
  if (typeof window !== "undefined" && typeof window.EventSource === "function") {
    try {
      return await streamBrowserJob(jobId, onUpdate, signal);
    } catch {
      if (signal?.aborted) throw abortError(signal);
      // Fall back to polling. Some local/dev proxies buffer or drop SSE.
    }
  }

  for (;;) {
    await wait(2000, signal);
    const response = await fetch(`/api/browser-jobs/${encodeURIComponent(jobId)}`, { cache: "no-store", signal });
    const job = (await readJson<{ job: BrowserJob }>(response)).job;
    onUpdate(job);
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return job;
  }
}

function streamBrowserJob(jobId: string, onUpdate: (job: BrowserJob) => void, signal?: AbortSignal): Promise<BrowserJob> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const source = new EventSource(`/api/browser-jobs/${encodeURIComponent(jobId)}/stream`);
    let latest: BrowserJob | null = null;
    let settled = false;

    const finish = (job: BrowserJob) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      source.close();
      resolve(job);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      source.close();
      reject(error);
    };

    const abort = () => fail(abortError(signal!));
    signal?.addEventListener("abort", abort, { once: true });

    source.addEventListener("job", (event) => {
      try {
        const job = JSON.parse((event as MessageEvent).data) as BrowserJob;
        latest = job;
        onUpdate(job);
        if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") finish(job);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });

    source.addEventListener("done", (event) => {
      try {
        const job = JSON.parse((event as MessageEvent).data) as BrowserJob;
        latest = job;
        onUpdate(job);
        finish(job);
      } catch {
        if (latest) finish(latest);
        else fail(new Error("Could not parse final job event"));
      }
    });

    source.addEventListener("error", () => {
      if (latest && (latest.status === "succeeded" || latest.status === "failed" || latest.status === "cancelled")) {
        finish(latest);
        return;
      }
      fail(new Error("Job stream failed"));
    });
  });
}
