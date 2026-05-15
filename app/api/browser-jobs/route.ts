import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { serializeBrowserActionJob, startBrowserActionJob, type BrowserActionType } from "@/lib/services/browserActionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const ACTIONS = new Set<BrowserActionType>(["playlistGroup.connect", "playlistTracks.refresh", "sync.run"]);

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const type = String(body.type || "") as BrowserActionType;
  if (!ACTIONS.has(type)) {
    return NextResponse.json({ error: "Unsupported job type" }, { status: 400 });
  }

  const job = await startBrowserActionJob(session.userId, type, body.input || {});
  return NextResponse.json({ job: serializeBrowserActionJob(job) }, { status: 202 });
}
