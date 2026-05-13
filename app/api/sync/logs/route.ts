import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const logs = await prisma.syncLog.findMany({
    where: { syncJob: { syncRule: { userId: session.userId } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ logs });
}
