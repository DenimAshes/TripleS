import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { refreshServicePlaylists } from "@/lib/services/playlistRefresh";
import { serviceKey } from "@/lib/services/adapterFactory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Per-service refresh so the UI can fetch just one service at a time and
// surface its outcome immediately (count, error message, isMock state).
// The bulk POST /api/playlists/refresh kicks off a background job for all
// three; this one runs synchronously and reports the result inline so the
// user can tell whether Spotify actually fetched or fell into a silent
// "isMock" branch.

export async function POST(request: Request, context: { params: Promise<{ service: string }> }) {
  const session = await requireAuth(request);
  const { service: raw } = await context.params;
  let key;
  try {
    key = serviceKey(raw);
  } catch {
    return NextResponse.json({ error: `Unknown service: ${raw}` }, { status: 400 });
  }
  if (key !== "spotify" && key !== "youtube" && key !== "soundcloud") {
    return NextResponse.json({ error: `Service ${key} can't be refreshed here` }, { status: 400 });
  }

  try {
    const count = await refreshServicePlaylists(session.userId, key);
    return NextResponse.json({ ok: true, service: key, count });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: key,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 200 },
    );
  }
}
