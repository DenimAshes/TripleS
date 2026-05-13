import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, sessionCookieName } from "@/lib/auth/session";
import { sameOriginUrl } from "@/lib/utils/requestUrl";

const publicPaths = ["/login", "/api/auth/login", "/api/auth/logout", "/api/auth/me"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const session = await verifySessionToken(request.cookies.get(sessionCookieName())?.value);
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(sameOriginUrl(request, "/login"));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
