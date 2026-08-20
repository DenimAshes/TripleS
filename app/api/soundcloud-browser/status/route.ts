import fs from "node:fs";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { stateFilePath } from "@/worker/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mirrors /api/youtube-browser/status so both browser-tool pages can say why
// they have nothing to show — automation switched off, or no saved session —
// instead of rendering empty panels.
export async function GET(request: Request) {
  await requireAuth(request);

  return NextResponse.json({
    hasState: fs.existsSync(stateFilePath("soundcloud")),
    isBrowserAutomationEnabled: process.env.SOUNDCLOUD_BROWSER_AUTOMATION === "true",
  });
}
