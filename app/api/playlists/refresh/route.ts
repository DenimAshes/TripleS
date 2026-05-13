import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { startPlaylistRefreshJob } from "@/lib/services/playlistRefreshJobs";

export async function POST(request: Request) {
  const session = await requireAuth(request);
  startPlaylistRefreshJob(session.userId);
  return NextResponse.json({ ok: true });
}
