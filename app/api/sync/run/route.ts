import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rateLimit";
import { prisma } from "@/lib/db/prisma";
import { serializeBrowserActionJob, startBrowserActionJob } from "@/lib/services/browserActionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Cap how often a single user can queue sync runs. Without this, repeatedly
// clicking "Run now" enqueues duplicate jobs which then compete for the
// advisory lock and waste browser-runner cold starts. Tuned generously
// (10 starts per minute) — real users won't hit it; runaway scripts will.
const SYNC_RUN_LIMIT = { windowMs: 60_000, max: 10 };

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const limit = rateLimit(`sync.run:${session.userId}`, SYNC_RUN_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.ceil(limit.retryAfterMs / 1000);
    return NextResponse.json(
      { error: "Too many sync runs queued. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  const body = await request.json().catch(() => ({}));
  const syncRuleId =
    body && typeof body === "object" && "syncRuleId" in body && body.syncRuleId
      ? String(body.syncRuleId).trim()
      : undefined;
  if (!syncRuleId) {
    return NextResponse.json({ error: "syncRuleId is required" }, { status: 400 });
  }

  const rule = await prisma.syncRule.findFirst({
    where: { id: syncRuleId, userId: session.userId },
    select: { id: true },
  });
  if (!rule) {
    return NextResponse.json({ error: "Sync rule not found" }, { status: 404 });
  }

  const job = await startBrowserActionJob(session.userId, "sync.run", { syncRuleId });
  return NextResponse.json({ job: serializeBrowserActionJob(job) }, { status: 202 });
}
