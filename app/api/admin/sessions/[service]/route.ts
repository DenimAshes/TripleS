import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVICES = new Set(["youtube", "spotify", "soundcloud"]);
const MAX_BYTES = 2_000_000;

type StorageState = {
  cookies?: unknown[];
  origins?: unknown[];
};

function isStorageState(value: unknown): value is StorageState {
  if (!value || typeof value !== "object") return false;
  const obj = value as StorageState;
  if (!Array.isArray(obj.cookies)) return false;
  if (obj.origins !== undefined && !Array.isArray(obj.origins)) return false;
  return true;
}

export async function GET(request: Request, { params }: { params: Promise<{ service: string }> }) {
  try {
    await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { service } = await params;
  if (!SERVICES.has(service)) return NextResponse.json({ error: "UNKNOWN_SERVICE" }, { status: 400 });

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
  if (!SERVICES.has(service)) return NextResponse.json({ error: "UNKNOWN_SERVICE" }, { status: 400 });

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "TOO_LARGE", limit: MAX_BYTES }, { status: 413 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  if (!isStorageState(parsed)) {
    return NextResponse.json({ error: "NOT_PLAYWRIGHT_STORAGE_STATE", hint: "Expected { cookies: [...], origins?: [...] }" }, { status: 422 });
  }

  const normalized = JSON.stringify(parsed);
  const bytes = Buffer.byteLength(normalized, "utf8");
  const stateGzipBase64 = gzipSync(Buffer.from(normalized, "utf8")).toString("base64");

  await prisma.workerSessionState.upsert({
    where: { service },
    update: { stateGzipBase64, bytes, updatedBy: session.email },
    create: { service, stateGzipBase64, bytes, updatedBy: session.email },
  });

  return NextResponse.json({ ok: true, service, bytes, updatedBy: session.email });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ service: string }> }) {
  try {
    await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { service } = await params;
  if (!SERVICES.has(service)) return NextResponse.json({ error: "UNKNOWN_SERVICE" }, { status: 400 });

  await prisma.workerSessionState.deleteMany({ where: { service } });
  return NextResponse.json({ ok: true });
}

