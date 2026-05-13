import fs from "node:fs";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { stateFilePath } from "@/worker/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  await requireAuth(request);

  return NextResponse.json({
    hasState: fs.existsSync(stateFilePath("youtube")),
    isBrowserAutomationEnabled: process.env.YOUTUBE_BROWSER_AUTOMATION === "true",
  });
}
