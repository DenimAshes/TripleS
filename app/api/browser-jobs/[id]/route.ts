import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { cancelBrowserActionJob, getBrowserActionJob, serializeBrowserActionJob } from "@/lib/services/browserActionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const job = await getBrowserActionJob(session.userId, id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job: serializeBrowserActionJob(job) });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const job = await cancelBrowserActionJob(session.userId, id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job: serializeBrowserActionJob(job) });
}
