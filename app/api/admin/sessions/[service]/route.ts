import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import {
  MAX_STATE_BYTES,
  isSessionService,
  normalizeStorageState,
  upsertWorkerSessionState,
} from "@/lib/services/workerSessionState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ service: string }> }) {
  try {
    await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { service } = await params;
  if (!isSessionService(service)) return NextResponse.json({ error: "UNKNOWN_SERVICE" }, { status: 400 });

  const row = await prisma.workerSessionState.findUnique({ where: { service } });
  return NextResponse.json({
    service,
    exists: !!row,
    bytes: row?.bytes ?? 0,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ service: string }> }) {
  let session;
  try {
    session = await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { service } = await params;
  if (!isSessionService(service)) return NextResponse.json({ error: "UNKNOWN_SERVICE" }, { status: 400 });

  const raw = await request.text();
  if (raw.length > MAX_STATE_BYTES) return NextResponse.json({ error: "TOO_LARGE", limit: MAX_STATE_BYTES }, { status: 413 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const state = normalizeStorageState(parsed);
  if (!state) {
    return NextResponse.json(
      {
        error: "NOT_RECOGNIZED",
        hint: "Expected Playwright storageState ({ cookies: [...] }) or a bare cookie array ([{ name, value, ... }]) from Cookie-Editor's JSON export.",
      },
      { status: 422 },
    );
  }

  const stored = await upsertWorkerSessionState({ service, state, updatedBy: session.email });

  return NextResponse.json({ ok: true, service, bytes: stored.bytes, cookies: stored.cookies, updatedBy: stored.updatedBy });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ service: string }> }) {
  try {
    await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { service } = await params;
  if (!isSessionService(service)) return NextResponse.json({ error: "UNKNOWN_SERVICE" }, { status: 400 });

  await prisma.workerSessionState.deleteMany({ where: { service } });
  return NextResponse.json({ ok: true });
}
