import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import {
  ensureSpotifyAccountForCookie,
  parseSpotifySpDc,
  setSpotifyWebCookie,
} from "@/lib/services/spotify/spotifyCookieStore";
import { webGetMe } from "@/lib/services/spotify/spotifyWebClient";
import { refreshServicePlaylists } from "@/lib/services/playlistRefresh";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const raw = typeof body.cookie === "string" ? body.cookie : "";
  // Accept raw value, full Cookie-Editor JSON export, Playwright storageState,
  // or a "Cookie:" header string — extract just the sp_dc value.
  const cookie = parseSpotifySpDc(raw);

  if (!cookie) {
    return NextResponse.json({ error: "Missing sp_dc cookie value" }, { status: 400 });
  }
  if (cookie.length < 20 || /\s/.test(cookie)) {
    return NextResponse.json(
      {
        error: "That doesn't look like an sp_dc value.",
        hint: "Paste the value of the sp_dc cookie from open.spotify.com (or a Cookie-Editor JSON export — both are accepted).",
      },
      { status: 400 },
    );
  }

  let me;
  try {
    me = await webGetMe(cookie);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cookie validation failed" },
      { status: 400 },
    );
  }

  await ensureSpotifyAccountForCookie({
    userId: session.userId,
    serviceUserId: me.id,
    serviceUsername: me.username,
  });

  await setSpotifyWebCookie(session.userId, cookie);
  await prisma.connectedAccount.update({
    where: { userId_service: { userId: session.userId, service: "SPOTIFY" } },
    data: {
      serviceUserId: me.id,
      serviceUsername: me.username,
      connectionStatus: "CONNECTED",
      lastError: null,
    },
  });

  let playlistCount = 0;
  let refreshError: string | null = null;
  try {
    playlistCount = await refreshServicePlaylists(session.userId, "spotify");
  } catch (err) {
    refreshError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    ok: true,
    profile: me,
    playlistCount,
    refreshError,
  });
}

export async function DELETE(request: Request) {
  const session = await requireAuth(request);
  await setSpotifyWebCookie(session.userId, null);
  return NextResponse.json({ ok: true });
}
