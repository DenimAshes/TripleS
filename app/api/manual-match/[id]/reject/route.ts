import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const existing = await prisma.manualMatchCandidate.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const match = await prisma.manualMatchCandidate.update({
    where: { id },
    data: { status: "REJECTED" },
  });
  return NextResponse.json({ match });
}
