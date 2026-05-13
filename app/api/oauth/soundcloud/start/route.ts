import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";

export async function POST(request: Request) {
  await requireAuth(request);
  return NextResponse.json({ url: process.env.SOUNDCLOUD_CLIENT_ID ? "https://secure.soundcloud.com/authorize" : "/settings?mock=soundcloud" });
}
