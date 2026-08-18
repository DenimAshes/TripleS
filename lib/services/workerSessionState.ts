import { gunzipSync, gzipSync } from "node:zlib";
import { prisma } from "@/lib/db/prisma";

export const SESSION_SERVICES = ["youtube", "spotify", "soundcloud"] as const;
export type SessionService = (typeof SESSION_SERVICES)[number];

export const MAX_STATE_BYTES = 2_000_000;

/**
 * Cookies that carry the logged-in session for each service. A stored state
 * without them restores "successfully" and then fails at runtime with a
 * not-logged-in error, so callers surface them instead of only byte counts.
 */
export const SESSION_COOKIE_HINTS: Record<SessionService, string[]> = {
  youtube: ["SID", "__Secure-1PSID", "__Secure-3PSID", "SAPISID", "LOGIN_INFO", "SIDCC"],
  spotify: ["sp_dc", "sp_key", "sp_t"],
  soundcloud: ["oauth_token", "sc_anonymous_id"],
};

export type PlaywrightCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type StorageState = {
  cookies: PlaywrightCookie[];
  origins: unknown[];
};

export function isSessionService(value: string): value is SessionService {
  return (SESSION_SERVICES as readonly string[]).includes(value);
}

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

/**
 * Accepts a Playwright storageState object or a bare cookie array (what
 * Cookie-Editor exports) and returns a canonical storage state.
 */
export function normalizeStorageState(raw: unknown): StorageState | null {
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

export type EncodedStorageState = {
  normalized: string;
  bytes: number;
  stateGzipBase64: string;
};

export function encodeStorageState(state: StorageState): EncodedStorageState {
  const normalized = JSON.stringify(state);
  return {
    normalized,
    bytes: Buffer.byteLength(normalized, "utf8"),
    stateGzipBase64: gzipSync(Buffer.from(normalized, "utf8")).toString("base64"),
  };
}

export function decodeStorageState(stateGzipBase64: string): StorageState | null {
  const json = gunzipSync(Buffer.from(stateGzipBase64.trim(), "base64")).toString("utf8");
  return normalizeStorageState(JSON.parse(json));
}

/** Names from SESSION_COOKIE_HINTS that the state actually carries. */
export function sessionCookiesPresent(service: SessionService, state: StorageState): string[] {
  const names = new Set(state.cookies.map((cookie) => cookie.name));
  return SESSION_COOKIE_HINTS[service].filter((name) => names.has(name));
}

export type StoredSessionSummary = {
  service: string;
  bytes: number;
  cookies: number;
  updatedAt: Date;
  updatedBy: string | null;
};

export async function upsertWorkerSessionState(input: {
  service: SessionService;
  state: StorageState;
  updatedBy: string;
}): Promise<StoredSessionSummary> {
  const { bytes, stateGzipBase64 } = encodeStorageState(input.state);
  const row = await prisma.workerSessionState.upsert({
    where: { service: input.service },
    update: { stateGzipBase64, bytes, updatedBy: input.updatedBy },
    create: { service: input.service, stateGzipBase64, bytes, updatedBy: input.updatedBy },
  });
  return {
    service: row.service,
    bytes: row.bytes,
    cookies: input.state.cookies.length,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}
