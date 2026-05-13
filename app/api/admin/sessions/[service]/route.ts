import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVICES = new Set(["youtube", "spotify", "soundcloud"]);
const MAX_BYTES = 2_000_000;

type PlaywrightCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type StorageState = {
  cookies: PlaywrightCookie[];
  origins: unknown[];
};

function normalizeSameSite(raw: unknown): "Strict" | "Lax" | "None" | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.toLowerCase();
  if (value === "strict") return "Strict";
  if (value === "lax") return "Lax";
  if (value === "none" || value === "no_restriction" || value === "unspecified") return "None";
  return undefined;
}

function normalizeCookie(raw: unknown): PlaywrightCookie | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || typeof r.value !== "string") return null;

  const cookie: PlaywrightCookie = { name: r.name, value: r.value };
  if (typeof r.domain === "string") cookie.domain = r.domain;
  if (typeof r.path === "string") cookie.path = r.path;

  const expires = typeof r.expires === "number" ? r.expires : typeof r.expirationDate === "number" ? r.expirationDate : undefined;
  if (typeof expires === "number" && Number.isFinite(expires)) cookie.expires = Math.floor(expires);

  if (typeof r.httpOnly === "boolean") cookie.httpOnly = r.httpOnly;
  if (typeof r.secure === "boolean") cookie.secure = r.secure;

  const sameSite = normalizeSameSite(r.sameSite);
  if (sameSite) cookie.sameSite = sameSite;

  return cookie;
}

function normalizeStorageState(raw: unknown): StorageState | null {
  if (Array.isArray(raw)) {
    const cookies = raw.map(normalizeCookie).filter((c): c is PlaywrightCookie => c !== null);
    if (cookies.length === 0) return null;
    return { cookies, origins: [] };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as { cookies?: unknown; origins?: unknown };
    if (Array.isArray(obj.cookies)) {
      const cookies = obj.cookies.map(normalizeCookie).filter((c): c is PlaywrightCookie => c !== null);
      if (cookies.length === 0) return null;
      const origins = Array.isArray(obj.origins) ? obj.origins : [];
      return { cookies, origins };
    }
  }
  return null;
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

  const normalized = JSON.stringify(state);
  const bytes = Buffer.byteLength(normalized, "utf8");
  const stateGzipBase64 = gzipSync(Buffer.from(normalized, "utf8")).toString("base64");

  await prisma.workerSessionState.upsert({
    where: { service },
    update: { stateGzipBase64, bytes, updatedBy: session.email },
    create: { service, stateGzipBase64, bytes, updatedBy: session.email },
  });

  return NextResponse.json({ ok: true, service, bytes, cookies: state.cookies.length, updatedBy: session.email });
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
