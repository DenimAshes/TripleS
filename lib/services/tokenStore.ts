import { prisma } from "@/lib/db/prisma";
import { decryptToken, encryptToken } from "@/lib/crypto/tokenEncryption";

export type StoredTokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
};

export async function getConnectedAccountToken(userId: string, service: string): Promise<StoredTokenPair | null> {
  const account = await prisma.connectedAccount.findUnique({
    where: { userId_service: { userId, service } },
  });
  if (!account || account.isMock) return null;

  return {
    accessToken: decryptToken(account.accessTokenEncrypted),
    refreshToken: decryptToken(account.refreshTokenEncrypted),
    expiresAt: account.expiresAt,
  };
}

export async function saveConnectedAccountTokens({
  userId,
  service,
  accessToken,
  refreshToken,
  expiresAt,
  serviceUserId,
  serviceUsername,
  isMock = false,
  connectionStatus = isMock ? "MOCK" : "CONNECTED",
  lastError = null,
}: {
  userId: string;
  service: string;
  accessToken: string;
  refreshToken: string;
  expiresAt?: Date;
  serviceUserId: string;
  serviceUsername: string;
  isMock?: boolean;
  connectionStatus?: string;
  lastError?: string | null;
}) {
  return prisma.connectedAccount.upsert({
    where: { userId_service: { userId, service } },
    update: {
      accessTokenEncrypted: encryptToken(accessToken),
      refreshTokenEncrypted: encryptToken(refreshToken),
      expiresAt,
      serviceUserId,
      serviceUsername,
      isMock,
      connectionStatus,
      lastError,
    },
    create: {
      userId,
      service,
      accessTokenEncrypted: encryptToken(accessToken),
      refreshTokenEncrypted: encryptToken(refreshToken),
      expiresAt,
      serviceUserId,
      serviceUsername,
      isMock,
      connectionStatus,
      lastError,
    },
  });
}
