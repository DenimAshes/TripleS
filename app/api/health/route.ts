import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "triples",
    timestamp: new Date().toISOString(),
  });
}
