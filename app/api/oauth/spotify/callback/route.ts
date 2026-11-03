import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { saveConnectedAccountTokens } from "@/lib/services/tokenStore";
import { getSpotifyRedirectUri, spotifyBasicAuthHeader } from "@/lib/services/spotify/spotifyAuth";
import type { SpotifyUser } from "@/lib/services/spotify/spotifyTypes";
import { refreshServicePlaylists } from "@/lib/services/playlistRefresh";
import { sameOriginUrl } from "@/lib/utils/requestUrl";

function spotifyErrorRedirect(request: Request, message: string) {
  const response = NextResponse.redirect(
    sameOriginUrl(request, `/connections?spotify_error=${encodeURIComponent(message)}#connection-spotify`),
  );
  response.cookies.delete("spotify_oauth_state");
  return response;
}

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
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

  if (!state || !cookieState || state !== cookieState) {
    return spotifyErrorRedirect(request, "Invalid or expired Spotify login state. Start the connection again.");
  }
  if (error) {
    return spotifyErrorRedirect(request, error === "access_denied" ? "Spotify login was cancelled." : error);
  }
  if (!code) return spotifyErrorRedirect(request, "Spotify did not return an authorization code. Start the connection again.");

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
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
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return spotifyErrorRedirect(request, "Spotify token exchange timed out. Start the connection again.");
  }

  if (!tokenResponse.ok) {
    console.warn(`Spotify token exchange failed: ${await tokenResponse.text()}`);
    return spotifyErrorRedirect(request, "Spotify login could not be completed. Start the connection again.");
  }

  const tokenPayload = await tokenResponse.json().catch(() => null) as Record<string, unknown> | null;
  const token = tokenPayload &&
    typeof tokenPayload.access_token === "string" &&
    typeof tokenPayload.refresh_token === "string" &&
    typeof tokenPayload.expires_in === "number" &&
    Number.isFinite(tokenPayload.expires_in) &&
    tokenPayload.expires_in > 0
    ? {
        access_token: tokenPayload.access_token,
        refresh_token: tokenPayload.refresh_token,
        expires_in: tokenPayload.expires_in,
      }
    : null;
  if (!token) {
    return spotifyErrorRedirect(request, "Spotify returned an invalid token response. Start the connection again.");
  }

  let profileResponse: Response | null = null;
  try {
    profileResponse = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Tokens are still useful for playlist access; store them as limited.
  }
  let profile: SpotifyUser | null = null;
  let profileError: string | null = null;
  if (!profileResponse) {
    profileError = "Spotify profile request timed out.";
  } else if (profileResponse.ok) {
    const profilePayload = await profileResponse.json().catch(() => null) as SpotifyUser | null;
    if (profilePayload && typeof profilePayload.id === "string") profile = profilePayload;
    else profileError = "Spotify returned an invalid profile response.";
  } else {
    profileError = await profileResponse.text();
    console.warn(`Spotify profile fetch failed: ${profileError}`);
  }

  if (!profile) {
    return spotifyErrorRedirect(request, profileError || "Spotify profile could not be verified. Start the connection again.");
  }

  await saveConnectedAccountTokens({
    userId: user.id,
    service: "SPOTIFY",
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    serviceUserId: profile.id,
    serviceUsername: profile.display_name || profile.email || "Spotify connected",
    connectionStatus: "CONNECTED",
    lastError: null,
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
      serviceUserId: profile.id,
      serviceUsername: profile.display_name || profile.email || "Spotify connected",
      connectionStatus: "LIMITED",
      lastError: message,
    });
  }

  const response = NextResponse.redirect(
    sameOriginUrl(request, "/dashboard?spotify=connected"),
  );
  response.cookies.delete("spotify_oauth_state");
  return response;
}
