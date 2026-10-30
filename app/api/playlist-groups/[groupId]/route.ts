import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  normalizePlaylistGroupSettings,
  PlaylistGroupSettingsError,
} from "@/lib/services/playlistGroupSettings";

function sourceKey(service: string, playlistId: string) {
  return `${service.toUpperCase()}:${playlistId}`;
}

export async function PATCH(request: Request, context: { params: Promise<{ groupId: string }> }) {
  const session = await requireAuth(request);
  const { groupId } = await context.params;

  let settings;
  try {
    settings = normalizePlaylistGroupSettings(await request.json().catch(() => ({})));
  } catch (error) {
    if (error instanceof PlaylistGroupSettingsError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const group = await prisma.playlistGroup.findFirst({
    where: { id: groupId, userId: session.userId },
    include: { members: { include: { playlist: true } } },
  });
  if (!group) return NextResponse.json({ error: "Sync group not found." }, { status: 404 });

  const memberBySource = new Map(
    group.members.map((member) => [
      sourceKey(member.playlist.service, member.playlist.servicePlaylistId),
      member.playlist,
    ]),
  );
  const rules = memberBySource.size
    ? await prisma.syncRule.findMany({
        where: {
          userId: session.userId,
          OR: Array.from(memberBySource.values()).map((playlist) => ({
            sourceService: playlist.service,
            sourcePlaylistId: playlist.servicePlaylistId,
          })),
        },
        include: { destinations: true },
      })
    : [];
  const memberKeys = new Set(memberBySource.keys());
  const groupRules = rules.filter(
    (rule) =>
      rule.direction === "TWO_WAY" ||
      (rule.destinations.length > 0 &&
        rule.destinations.every((destination) => memberKeys.has(sourceKey(destination.service, destination.playlistId)))),
  );

  await prisma.$transaction(async (tx) => {
    await tx.playlistGroup.update({ where: { id: group.id }, data: { name: settings.name } });
    for (const rule of groupRules) {
      const source = memberBySource.get(sourceKey(rule.sourceService, rule.sourcePlaylistId));
      await tx.syncRule.update({
        where: { id: rule.id },
        data: {
          name: source ? `${settings.name} - ${source.name}` : settings.name,
          mode: settings.mode,
          direction: "TWO_WAY",
          intervalMinutes: settings.intervalMinutes,
          ...(rule.isEnabled
            ? { nextRunAt: null, queuedReason: "rule_updated", queuedAt: new Date() }
            : {}),
        },
      });
    }
  });

  return NextResponse.json({
    ok: true,
    updatedRules: groupRules.length,
    queuedSources: groupRules.filter((rule) => rule.isEnabled).length,
  });
}
