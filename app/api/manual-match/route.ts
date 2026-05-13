import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const matches = await prisma.manualMatchCandidate.findMany({
    where: { userId: session.userId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ matches });
}
