import fs from "node:fs";
import { binaryInfo } from "cloakbrowser";
import { prisma } from "@/lib/db/prisma";
import { stateFilePath } from "@/worker/config";
import { shouldRefreshSourceCache } from "@/lib/sync/sourceCachePolicy";

type Status = "OK" | "WARN" | "FAIL";

type Check = {
  status: Status;
  name: string;
  detail: string;
};

function print(checks: Check[]) {
  for (const check of checks) {
    console.log(`[${check.status}] ${check.name}: ${check.detail}`);
  }
  const fail = checks.filter((check) => check.status === "FAIL").length;
  const warn = checks.filter((check) => check.status === "WARN").length;
  console.log(`\nSummary: ${fail} fail, ${warn} warn, ${checks.length - fail - warn} ok`);
  process.exitCode = fail ? 1 : 0;
}

async function main() {
  const checks: Check[] = [];

  try {
    const info = binaryInfo();
    checks.push({
      status: info.installed ? "OK" : "FAIL",
      name: "CloakBrowser",
      detail: info.installed ? `${info.version} at ${info.binaryPath}` : "binary is not installed",
    });
  } catch (error) {
    checks.push({ status: "FAIL", name: "CloakBrowser", detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const [users, playlists, rules] = await Promise.all([
      prisma.user.count(),
      prisma.playlist.count(),
      prisma.syncRule.count(),
    ]);
    checks.push({ status: "OK", name: "database", detail: `${users} users, ${playlists} playlists, ${rules} sync rules` });
  } catch (error) {
    checks.push({ status: "FAIL", name: "database", detail: error instanceof Error ? error.message : String(error) });
  }

  for (const service of ["youtube", "soundcloud"] as const) {
    const enabled = process.env[service === "youtube" ? "YOUTUBE_BROWSER_AUTOMATION" : "SOUNDCLOUD_BROWSER_AUTOMATION"] === "true";
    const path = stateFilePath(service);
    checks.push({
      status: !enabled || fs.existsSync(path) ? "OK" : "FAIL",
      name: `${service} browser state`,
      detail: enabled ? path : "browser automation disabled",
    });
  }

  const dueRules = await prisma.syncRule.findMany({
    where: { isEnabled: true },
    include: { destinations: { where: { isEnabled: true } } },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  checks.push({
    status: dueRules.length ? "OK" : "WARN",
    name: "enabled sync rules",
    detail: dueRules.length ? dueRules.map((rule) => rule.name).join(" | ") : "none",
  });

  const playlistRefs = dueRules.flatMap((rule) => [
    { service: rule.sourceService, servicePlaylistId: rule.sourcePlaylistId },
    ...rule.destinations.map((destination) => ({
      service: destination.service,
      servicePlaylistId: destination.playlistId,
    })),
  ]);
  const playlistsForRules = playlistRefs.length
    ? await prisma.playlist.findMany({
        where: { OR: playlistRefs },
      })
    : [];
  const playlistByKey = new Map(
    playlistsForRules.map((playlist) => [`${playlist.service}::${playlist.servicePlaylistId}`, playlist]),
  );
  const activeCounts = playlistsForRules.length
    ? await prisma.playlistTrackState.groupBy({
        by: ["playlistId"],
        where: { playlistId: { in: playlistsForRules.map((playlist) => playlist.id) }, removedAt: null },
        _count: { _all: true },
      })
    : [];
  const activeCountByPlaylistId = new Map(activeCounts.map((row) => [row.playlistId, row._count._all]));

  for (const rule of dueRules) {
    const source = playlistByKey.get(`${rule.sourceService}::${rule.sourcePlaylistId}`);
    if (!source) {
      checks.push({ status: "FAIL", name: `${rule.name} source`, detail: "missing playlist row" });
      continue;
    }
    const active = activeCountByPlaylistId.get(source.id) ?? 0;
    const complete = source.trackCount <= 0 || active >= source.trackCount;
    const willRefreshLive = shouldRefreshSourceCache({ lastFetchedAt: source.lastFetchedAt });
    checks.push({
      status: complete || willRefreshLive ? "OK" : "WARN",
      name: `${rule.name} source cache`,
      detail: complete
        ? `${active}/${source.trackCount} active tracks`
        : `${active}/${source.trackCount} active tracks; worker will refresh live before syncing`,
    });

    for (const destination of rule.destinations) {
      const playlist = playlistByKey.get(`${destination.service}::${destination.playlistId}`);
      checks.push({
        status: playlist?.isWritable ? "OK" : "FAIL",
        name: `${rule.name} ${destination.service} destination`,
        detail: playlist ? `${playlist.name}, writable=${playlist.isWritable}` : "missing playlist row",
      });
    }
  }

  print(checks);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

