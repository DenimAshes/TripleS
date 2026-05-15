import { requireAuth } from "@/lib/auth/session";
import { getBrowserActionJob, serializeBrowserActionJob } from "@/lib/services/browserActionJobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_INTERVAL_MS = Number(process.env.BROWSER_JOB_STREAM_POLL_INTERVAL_MS ?? 1000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.BROWSER_JOB_STREAM_HEARTBEAT_MS ?? 15_000);
const MAX_STREAM_MS = Number(process.env.BROWSER_JOB_STREAM_MAX_MS ?? 30 * 60_000);
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const initial = await getBrowserActionJob(session.userId, id);
  if (!initial) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      let lastPayload = "";
      let closed = false;

      const send = (event: string, payload: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${payload}\n\n`));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };

      const sendJob = (event: string, job: typeof initial) => {
        const payload = JSON.stringify(serializeBrowserActionJob(job));
        lastPayload = payload;
        send(event, payload);
      };

      sendJob("job", initial);
      if (TERMINAL.has(initial.status)) {
        close();
        return;
      }

      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
      }, HEARTBEAT_INTERVAL_MS);

      const abortHandler = () => {
        clearInterval(heartbeat);
        close();
      };
      request.signal.addEventListener("abort", abortHandler, { once: true });

      try {
        while (!closed) {
          if (Date.now() - startedAt > MAX_STREAM_MS) {
            send("timeout", JSON.stringify({ reason: "stream exceeded max duration" }));
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          if (closed) break;

          const fresh = await getBrowserActionJob(session.userId, id).catch(() => null);
          if (!fresh) {
            send("error", JSON.stringify({ error: "Job not found" }));
            break;
          }

          const payload = JSON.stringify(serializeBrowserActionJob(fresh));
          if (payload !== lastPayload) {
            lastPayload = payload;
            send("job", payload);
          }
          if (TERMINAL.has(fresh.status)) {
            send("done", payload);
            break;
          }
        }
      } finally {
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", abortHandler);
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
