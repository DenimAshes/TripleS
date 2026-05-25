import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { serializeBrowserActionJob, startBrowserActionJob } from "@/lib/services/browserActionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const playlist = await prisma.playlist.findFirst({
    where: { id, userId: session.userId },
    select: { id: true },
  });
  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }
  const job = await startBrowserActionJob(session.userId, "playlistTracks.refresh", { playlistId: id });
  return NextResponse.json({ job: serializeBrowserActionJob(job) }, { status: 202 });
}
