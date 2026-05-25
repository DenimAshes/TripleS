import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { serializeBrowserActionJob, startBrowserActionJob, type BrowserActionType } from "@/lib/services/browserActionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const ACTIONS = new Set<BrowserActionType>(["playlistGroup.connect", "playlistTracks.refresh", "sync.run"]);

function inputObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const type = String(body.type || "") as BrowserActionType;
  if (!ACTIONS.has(type)) {
    return NextResponse.json({ error: "Unsupported job type" }, { status: 400 });
  }

  const input = inputObject(body.input);
  if (type === "sync.run") {
    const syncRuleId = input.syncRuleId ? String(input.syncRuleId).trim() : "";
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
    input.syncRuleId = syncRuleId;
  }

  if (type === "playlistTracks.refresh") {
    const playlistId = input.playlistId ? String(input.playlistId).trim() : "";
    if (!playlistId) {
      return NextResponse.json({ error: "playlistId is required" }, { status: 400 });
    }
    const playlist = await prisma.playlist.findFirst({
      where: { id: playlistId, userId: session.userId },
      select: { id: true },
    });
    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    input.playlistId = playlistId;
  }

  const job = await startBrowserActionJob(session.userId, type, input);
  return NextResponse.json({ job: serializeBrowserActionJob(job) }, { status: 202 });
}
