import { NextResponse } from "next/server";
import { binaryInfo } from "cloakbrowser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  let cloak: { version: string; platform: string; installed: boolean; binaryPath: string } | { error: string };
  try {
    const info = binaryInfo();
    cloak = {
      version: info.version,
      platform: info.platform,
      installed: info.installed,
      binaryPath: info.binaryPath,
    };
  } catch (error) {
    cloak = { error: error instanceof Error ? error.message : String(error) };
  }

  return NextResponse.json({
    ok: true,
    service: "triples",
    timestamp: new Date().toISOString(),
    cloakbrowser: cloak,
  });
}
