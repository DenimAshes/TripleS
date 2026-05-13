import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId: session.userId },
    select: {
      id: true,
      service: true,
      serviceUserId: true,
      serviceUsername: true,
      isMock: true,
      connectionStatus: true,
      lastError: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ accounts });
}
