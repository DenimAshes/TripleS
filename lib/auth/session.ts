import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const COOKIE_NAME = "triples_session";
const DEFAULT_JWT_SECRET = "dev-only-jwt-secret-change-me";

export type SessionUser = {
  userId: string;
  email: string;
  name: string;
};

function secret() {
  return new TextEncoder().encode(process.env.JWT_SECRET || DEFAULT_JWT_SECRET);
}

export async function createSessionToken(user: SessionUser) {
  return new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function verifySessionToken(token?: string): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      userId: String(payload.userId),
      email: String(payload.email),
      name: String(payload.name),
    };
  } catch {
    return null;
  }
}

export async function getSession() {
  const store = await cookies();
  return verifySessionToken(store.get(COOKIE_NAME)?.value);
}

export async function requireAuth(request: Request | NextRequest) {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.split("=")[1];
  const session = await verifySessionToken(token);
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export function sessionCookieName() {
  return COOKIE_NAME;
}
