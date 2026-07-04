import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rateLimit";
import { runDueSyncRules } from "@/lib/services/dueSyncRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RUN_DUE_LIMIT = { windowMs: 60_000, max: 4 };

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const limit = rateLimit(`sync.queue.run-due:${session.userId}`, RUN_DUE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.ceil(limit.retryAfterMs / 1000);
    return NextResponse.json(
      { error: "Too many queue runs. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const result = await runDueSyncRules({ userId: session.userId });
  return NextResponse.json(result);
}
