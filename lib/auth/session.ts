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
  const configured = process.env.JWT_SECRET?.trim();
  if (process.env.NODE_ENV === "production" && (
    !configured ||
    configured === DEFAULT_JWT_SECRET ||
    configured === "replace-me" ||
    configured.length < 32
  )) {
    throw new Error("JWT_SECRET must be a unique value of at least 32 characters in production.");
  }
  return new TextEncoder().encode(configured || DEFAULT_JWT_SECRET);
}

async function existingSessionUser(session: SessionUser | null): Promise<SessionUser | null> {
  if (!session) return null;
  const { prisma } = await import("@/lib/db/prisma");
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true },
  });
  return user ? { userId: user.id, email: user.email, name: user.name } : null;
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
  return existingSessionUser(await verifySessionToken(store.get(COOKIE_NAME)?.value));
}

export async function requireAuth(request: Request | NextRequest) {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.split("=")[1];
  const session = await existingSessionUser(await verifySessionToken(token));
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export function sessionCookieName() {
  return COOKIE_NAME;
}
