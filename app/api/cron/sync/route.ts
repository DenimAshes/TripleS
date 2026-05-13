import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { runSync } from "@/lib/sync/syncEngine";

export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get("secret") || request.headers.get("x-cron-secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rules = await prisma.syncRule.findMany({ where: { isEnabled: true } });
  const jobs = [];
  for (const rule of rules) {
    jobs.push(await runSync(rule.id));
  }
  return NextResponse.json({ jobs });
}
