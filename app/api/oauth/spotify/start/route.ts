import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { buildSpotifyAuthorizeUrl, createSpotifyState, hasSpotifyCredentials, validateSpotifyRedirectUri } from "@/lib/services/spotify/spotifyAuth";
import { sameOriginUrl } from "@/lib/utils/requestUrl";

export async function POST(request: Request) {
  await requireAuth(request);
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  if (!hasSpotifyCredentials()) {
    if (acceptsHtml) {
      return NextResponse.redirect(sameOriginUrl(request, "/settings?mock=spotify"), 303);
    }
    return NextResponse.json({ url: "/settings?mock=spotify", mode: "mock" });
  }
  const redirectValidation = validateSpotifyRedirectUri();
  if (!redirectValidation.ok) {
    if (acceptsHtml) {
      return NextResponse.redirect(sameOriginUrl(request, `/settings?spotify_error=${encodeURIComponent(redirectValidation.error || "invalid_redirect")}`), 303);
    }
    return NextResponse.json({ error: redirectValidation.error }, { status: 400 });
  }

  const state = createSpotifyState();
  const authorizeUrl = buildSpotifyAuthorizeUrl(state);
  const response = acceptsHtml
    ? NextResponse.redirect(authorizeUrl, 303)
    : NextResponse.json({ url: authorizeUrl, mode: "oauth" });
  response.cookies.set("spotify_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
