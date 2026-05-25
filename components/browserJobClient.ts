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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

export async function pollBrowserJob(jobId: string, onUpdate: (job: BrowserJob) => void): Promise<BrowserJob> {
  if (typeof window !== "undefined" && typeof window.EventSource === "function") {
    try {
      return await streamBrowserJob(jobId, onUpdate);
    } catch {
      // Fall back to polling. Some local/dev proxies buffer or drop SSE.
    }
  }

  for (;;) {
    await wait(2000);
    const response = await fetch(`/api/browser-jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const job = (await readJson<{ job: BrowserJob }>(response)).job;
    onUpdate(job);
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return job;
  }
}

function streamBrowserJob(jobId: string, onUpdate: (job: BrowserJob) => void): Promise<BrowserJob> {
  return new Promise((resolve, reject) => {
    const source = new EventSource(`/api/browser-jobs/${encodeURIComponent(jobId)}/stream`);
    let latest: BrowserJob | null = null;
    let settled = false;

    const finish = (job: BrowserJob) => {
      if (settled) return;
      settled = true;
      source.close();
      resolve(job);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      source.close();
      reject(error);
    };

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
