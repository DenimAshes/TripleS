import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { serializeBrowserActionJob, startBrowserActionJob } from "@/lib/services/browserActionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const job = await startBrowserActionJob(session.userId, "sync.run", { syncRuleId: body.syncRuleId ? String(body.syncRuleId) : undefined });
  return NextResponse.json({ job: serializeBrowserActionJob(job) }, { status: 202 });
}
