import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { runSync } from "@/lib/sync/syncEngine";

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const rule = body.syncRuleId
    ? await prisma.syncRule.findFirst({ where: { id: body.syncRuleId, userId: session.userId } })
    : await prisma.syncRule.findFirst({ where: { userId: session.userId, isEnabled: true } });
  if (!rule) return NextResponse.json({ error: "No sync rule found" }, { status: 404 });
  const job = await runSync(rule.id);
  return NextResponse.json({ job });
}
