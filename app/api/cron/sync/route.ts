import { NextResponse } from "next/server";
import { runDueSyncRules } from "@/lib/services/dueSyncRunner";

export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get("secret") || request.headers.get("x-cron-secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDueSyncRules());
}
