import { prisma } from "@/lib/db/prisma";
import { decryptToken, encryptToken } from "@/lib/crypto/tokenEncryption";

// Accept several formats people actually paste into the sp_dc field and
// pull out just the raw cookie value. Without this, the JSON exports from
// Cookie-Editor get fed verbatim into `Cookie: sp_dc=…`, Spotify returns
// 401, and the connector looks broken.
export function parseSpotifySpDc(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";

  // Plain value (case the field was originally designed for).
  // Spotify's sp_dc looks like "AQB..." or similar token chars, no spaces /
  // braces / semicolons.
  if (!/[{\[;=]/.test(trimmed)) return trimmed;

  // Try JSON forms first.
  try {
    const parsed: unknown = JSON.parse(trimmed);
    // Cookie-Editor "Export as JSON" -> array of cookie objects
    if (Array.isArray(parsed)) {
      const entry = parsed.find(
        (cookie): cookie is { name?: unknown; value?: unknown } =>
          typeof cookie === "object" && cookie != null && (cookie as { name?: unknown }).name === "sp_dc",
      );
      if (entry && typeof entry.value === "string") return entry.value.trim();
    }
    // Playwright storageState -> { cookies: [...], origins: [...] }
    if (typeof parsed === "object" && parsed != null && Array.isArray((parsed as { cookies?: unknown[] }).cookies)) {
      const entry = (parsed as { cookies: Array<{ name?: unknown; value?: unknown }> }).cookies.find(
        (cookie) => cookie?.name === "sp_dc",
      );
      if (entry && typeof entry.value === "string") return entry.value.trim();
    }
    // Single cookie object: { name: "sp_dc", value: "..." }
    if (
      typeof parsed === "object" &&
      parsed != null &&
      (parsed as { name?: unknown }).name === "sp_dc" &&
      typeof (parsed as { value?: unknown }).value === "string"
    ) {
      return ((parsed as { value: string }).value).trim();
    }
  } catch {
    // Not JSON; might be a raw "Cookie:" header string.
  }

  // Cookie header form: "sp_dc=AQB...; sp_t=..." or just "sp_dc=AQB..."
  const match = trimmed.match(/(?:^|[;\s])sp_dc=([^;\s]+)/i);
  if (match) return match[1].trim();

  // Last resort: return as-is and let webGetMe surface the auth error.
  return trimmed;
}

export async function getSpotifyWebCookie(userId: string): Promise<string | null> {
  const account = await prisma.connectedAccount.findUnique({
    where: { userId_service: { userId, service: "SPOTIFY" } },
    select: { webCookieEncrypted: true },
  });
  const encrypted = account?.webCookieEncrypted;
  if (!encrypted) return null;
  try {
    return decryptToken(encrypted);
  } catch {
    return null;
  }
}

export async function setSpotifyWebCookie(userId: string, cookie: string | null) {
  const encrypted = cookie ? encryptToken(cookie) : null;
  await prisma.connectedAccount.update({
    where: { userId_service: { userId, service: "SPOTIFY" } },
    data: { webCookieEncrypted: encrypted },
  });
}

export async function ensureSpotifyAccountForCookie(params: {
  userId: string;
  serviceUserId: string;
  serviceUsername: string;
}) {
  const existing = await prisma.connectedAccount.findUnique({
    where: { userId_service: { userId: params.userId, service: "SPOTIFY" } },
  });
  // Flip isMock=false and clear errors on existing rows too — without this,
  // an account left over from an earlier mock-mode init keeps isMock=true
  // and refreshServicePlaylists silently returns 0 for Spotify.
  if (existing) {
    return prisma.connectedAccount.update({
      where: { id: existing.id },
      data: {
        serviceUserId: params.serviceUserId,
        serviceUsername: params.serviceUsername,
        isMock: false,
        connectionStatus: "CONNECTED",
        lastError: null,
      },
    });
  }
  return prisma.connectedAccount.create({
    data: {
      userId: params.userId,
      service: "SPOTIFY",
      accessTokenEncrypted: "",
      refreshTokenEncrypted: "",
      serviceUserId: params.serviceUserId,
      serviceUsername: params.serviceUsername,
      isMock: false,
      connectionStatus: "CONNECTED",
    },
  });
}
