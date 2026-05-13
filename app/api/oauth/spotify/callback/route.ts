import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { saveConnectedAccountTokens } from "@/lib/services/tokenStore";
import { getSpotifyRedirectUri, spotifyBasicAuthHeader } from "@/lib/services/spotify/spotifyAuth";
import type { SpotifyUser } from "@/lib/services/spotify/spotifyTypes";
import { refreshServicePlaylists } from "@/lib/services/playlistRefresh";
import { sameOriginUrl } from "@/lib/utils/requestUrl";

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const sessionUser = await prisma.user.findUnique({ where: { id: session.userId } });
  const user =
    sessionUser ||
    (await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL || "admin@example.com" } }));
  if (!user) {
    return NextResponse.json({ error: "Authenticated user no longer exists. Run npx prisma db seed and login again." }, { status: 401 });
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("spotify_oauth_state="))
    ?.split("=")[1];

  if (error) {
    return NextResponse.redirect(sameOriginUrl(request, `/settings?spotify_error=${encodeURIComponent(error)}`));
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: "Invalid Spotify OAuth state" }, { status: 400 });
  }

  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: spotifyBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getSpotifyRedirectUri(),
    }),
  });

  if (!tokenResponse.ok) {
    return NextResponse.json({ error: "Spotify token exchange failed", details: await tokenResponse.text() }, { status: 502 });
  }

  const token = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const profileResponse = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  let profile: SpotifyUser | null = null;
  let profileError: string | null = null;
  if (profileResponse.ok) {
    profile = (await profileResponse.json()) as SpotifyUser;
  } else {
    profileError = await profileResponse.text();
    console.warn(`Spotify profile fetch failed, saving tokens with fallback account: ${profileError}`);
  }

  const connectionStatus = profileError ? "LIMITED" : "CONNECTED";
  await saveConnectedAccountTokens({
    userId: user.id,
    service: "SPOTIFY",
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    serviceUserId: profile?.id || `spotify_user_${user.id}`,
    serviceUsername: profile?.display_name || profile?.email || "Spotify connected",
    connectionStatus,
    lastError: profileError,
  });

  try {
    await refreshServicePlaylists(user.id, "spotify");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Spotify playlist refresh skipped after OAuth: ${message}`);
    await saveConnectedAccountTokens({
      userId: user.id,
      service: "SPOTIFY",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      serviceUserId: profile?.id || `spotify_user_${user.id}`,
      serviceUsername: profile?.display_name || profile?.email || "Spotify connected",
      connectionStatus: "LIMITED",
      lastError: profileError || message,
    });
  }

  const response = NextResponse.redirect(
    sameOriginUrl(request, profileError ? "/dashboard?spotify=connected_profile_limited" : "/dashboard?spotify=connected"),
  );
  response.cookies.delete("spotify_oauth_state");
  return response;
}
