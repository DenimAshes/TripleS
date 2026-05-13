import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, todo: "TODO: persist real SoundCloud OAuth tokens here." });
}
