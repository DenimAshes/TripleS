import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Toggle a playlist's "hidden from picker" flag. Hiding doesn't delete the
// row or touch the upstream service — it's purely a UI filter so users can
// prune leftover or non-owned playlists from the list without breaking any
// sync rule that already references them.
//
// Body (optional): { hidden: boolean }. Omit to toggle.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const playlist = await prisma.playlist.findUnique({ where: { id } });
  if (!playlist || playlist.userId !== session.userId) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const next = typeof body?.hidden === "boolean" ? body.hidden : !playlist.hidden;
  const updated = await prisma.playlist.update({
    where: { id },
    data: { hidden: next },
    select: { id: true, hidden: true },
  });
  return NextResponse.json({ playlist: updated });
}
