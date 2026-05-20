import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVICES = ["youtube", "spotify", "soundcloud"];

export async function GET(request: Request) {
  try {
    await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const rows = await prisma.workerSessionState.findMany({ where: { service: { in: SERVICES } } });
  const byService = new Map(rows.map((r) => [r.service, r]));

  return NextResponse.json({
    sessions: SERVICES.map((service) => {
      const row = byService.get(service);
      return {
        service,
        exists: !!row,
        bytes: row?.bytes ?? 0,
        updatedAt: row?.updatedAt?.toISOString() ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    }),
  });
}
