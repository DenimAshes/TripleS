import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSessionToken, sessionCookieName } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rateLimit";
import { sameOriginUrl } from "@/lib/utils/requestUrl";

const LOGIN_LIMIT = { windowMs: 15 * 60_000, max: 10 };
const DUMMY_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const isForm = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  const body = isForm
    ? Object.fromEntries(await request.formData().catch(() => new FormData()))
    : await request.json().catch(() => ({}));
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const ipLimit = rateLimit(`auth.login.ip:${clientIp(request)}`, LOGIN_LIMIT);
  const accountLimit = ipLimit.allowed
    ? rateLimit(`auth.login.account:${email || "unknown"}`, LOGIN_LIMIT)
    : null;
  const blocked = !ipLimit.allowed ? ipLimit : accountLimit && !accountLimit.allowed ? accountLimit : null;
  if (blocked) {
    const retryAfter = Math.ceil(blocked.retryAfterMs / 1000);
    if (isForm) {
      return NextResponse.redirect(sameOriginUrl(request, "/login?error=rate_limited"), {
        status: 303,
        headers: { "Retry-After": String(retryAfter) },
      });
    }
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  const passwordValid = await verifyPassword(password, user?.passwordHash || DUMMY_PASSWORD_HASH);

  if (!user || !passwordValid) {
    if (isForm) {
      return NextResponse.redirect(sameOriginUrl(request, "/login?error=invalid"), 303);
    }
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createSessionToken({ userId: user.id, email: user.email, name: user.name });
  const response = isForm
    ? NextResponse.redirect(sameOriginUrl(request, "/dashboard"), 303)
    : NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  response.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
