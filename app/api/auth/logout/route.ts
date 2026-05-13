import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/auth/session";
import { sameOriginUrl } from "@/lib/utils/requestUrl";

export async function POST(request: Request) {
  const response = NextResponse.redirect(sameOriginUrl(request, "/login"));
  response.cookies.delete(sessionCookieName());
  return response;
}
