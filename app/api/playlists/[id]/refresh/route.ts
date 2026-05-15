import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { serializeBrowserActionJob, startBrowserActionJob } from "@/lib/services/browserActionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const job = await startBrowserActionJob(session.userId, "playlistTracks.refresh", { playlistId: id });
  return NextResponse.json({ job: serializeBrowserActionJob(job) }, { status: 202 });
}
