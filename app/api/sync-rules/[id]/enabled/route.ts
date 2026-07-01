import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

function enabledFromBody(body: unknown): boolean | null {
  if (!body || typeof body !== "object" || !("enabled" in body)) return null;
  const value = (body as { enabled?: unknown }).enabled;
  return typeof value === "boolean" ? value : null;
}

async function enabledSiblingSourceCount(rule: {
  userId: string;
  sourceService: string;
  sourcePlaylistId: string;
}) {
  const sourcePlaylist = await prisma.playlist.findUnique({
    where: {
      service_servicePlaylistId: {
        service: rule.sourceService,
        servicePlaylistId: rule.sourcePlaylistId,
      },
    },
    select: { id: true },
  });
  if (!sourcePlaylist) return null;

  const member = await prisma.playlistGroupMember.findUnique({
    where: { playlistId: sourcePlaylist.id },
    select: { groupId: true },
  });
  if (!member) return null;

  const groupMembers = await prisma.playlistGroupMember.findMany({
    where: { groupId: member.groupId },
    include: { playlist: { select: { service: true, servicePlaylistId: true } } },
  });
  if (!groupMembers.length) return null;

  return prisma.syncRule.count({
    where: {
      userId: rule.userId,
      direction: "TWO_WAY",
      isEnabled: true,
      OR: groupMembers.map((item) => ({
        sourceService: item.playlist.service,
        sourcePlaylistId: item.playlist.servicePlaylistId,
      })),
    },
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const enabled = enabledFromBody(body);
  if (enabled === null) {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const existing = await prisma.syncRule.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!enabled && existing.direction === "TWO_WAY") {
    const siblingEnabledCount = await enabledSiblingSourceCount(existing);
    if (siblingEnabledCount !== null && siblingEnabledCount <= 1) {
      return NextResponse.json({ error: "Keep at least one source platform enabled." }, { status: 409 });
    }
  }

  const rule = await prisma.syncRule.update({
    where: { id },
    data: {
      isEnabled: enabled,
      nextRunAt: enabled ? null : existing.nextRunAt,
      queuedReason: enabled ? "rule_enabled" : existing.queuedReason,
      queuedAt: enabled ? new Date() : existing.queuedAt,
    },
    include: { destinations: true },
  });
  return NextResponse.json({ rule });
}
