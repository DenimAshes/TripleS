import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSessionToken, sessionCookieName } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { sameOriginUrl } from "@/lib/utils/requestUrl";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const isForm = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  const body = isForm ? Object.fromEntries(await request.formData()) : await request.json();
  const email = String(body.email || "");
  const password = String(body.password || "");
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    if (isForm) {
      return NextResponse.redirect(sameOriginUrl(request, "/login?error=invalid"));
    }
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createSessionToken({ userId: user.id, email: user.email, name: user.name });
  const response = isForm
    ? NextResponse.redirect(sameOriginUrl(request, "/dashboard"))
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
