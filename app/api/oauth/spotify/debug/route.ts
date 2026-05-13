import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import {
  buildSpotifyAuthorizeUrl,
  createSpotifyState,
  getSpotifyRedirectUri,
  getSpotifyScopes,
  hasSpotifyCredentials,
  validateSpotifyRedirectUri,
} from "@/lib/services/spotify/spotifyAuth";
import { prisma } from "@/lib/db/prisma";
import { decryptToken } from "@/lib/crypto/tokenEncryption";

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const clientId = process.env.SPOTIFY_CLIENT_ID || "";
  const redirectValidation = validateSpotifyRedirectUri();

  const account = await prisma.connectedAccount.findUnique({
    where: { userId_service: { userId: session.userId, service: "SPOTIFY" } },
  });

  let liveCheck: unknown = null;
  if (account && !account.isMock) {
    try {
      const accessToken = decryptToken(account.accessTokenEncrypted);
      const meResp = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const meBody = await meResp.text();
      const playlistsResp = await fetch("https://api.spotify.com/v1/me/playlists?limit=5", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const playlistsBody = await playlistsResp.text();
      liveCheck = {
        me: { status: meResp.status, body: meBody.slice(0, 500) },
        playlists: { status: playlistsResp.status, body: playlistsBody.slice(0, 500) },
      };
    } catch (err) {
      liveCheck = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return NextResponse.json({
    hasClientId: Boolean(process.env.SPOTIFY_CLIENT_ID),
    hasClientSecret: Boolean(process.env.SPOTIFY_CLIENT_SECRET),
    hasCredentials: hasSpotifyCredentials(),
    clientIdPreview: clientId ? `${clientId.slice(0, 6)}...${clientId.slice(-4)}` : null,
    redirectUri: getSpotifyRedirectUri(),
    redirectUriValid: redirectValidation.ok,
    redirectUriError: redirectValidation.error,
    scopes: getSpotifyScopes().split(" "),
    account: account
      ? {
          serviceUserId: account.serviceUserId,
          serviceUsername: account.serviceUsername,
          isMock: account.isMock,
          connectionStatus: account.connectionStatus,
          lastError: account.lastError,
          expiresAt: account.expiresAt,
          updatedAt: account.updatedAt,
        }
      : null,
    liveCheck,
    authorizeUrlPreview: hasSpotifyCredentials() && redirectValidation.ok ? buildSpotifyAuthorizeUrl(createSpotifyState()) : null,
  });
}
