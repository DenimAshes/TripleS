import { prisma } from "@/lib/db/prisma";
import { decryptToken, encryptToken } from "@/lib/crypto/tokenEncryption";

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
  if (existing) return existing;
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
