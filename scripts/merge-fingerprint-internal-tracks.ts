import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { extractVariantTag } from "@/lib/utils/normalizeTrack";

type Row = {
  id: string;
  internalTrackId: string;
  service: string;
  serviceTrackId: string;
  title: string;
  titleNormalized: string | null;
  artistNormalized: string | null;
  durationBucket: number | null;
};

function fingerprintKey(row: Row) {
  if (!row.titleNormalized || !row.artistNormalized || row.durationBucket == null) return null;
  if (row.titleNormalized.length < 3 || row.artistNormalized.length < 2) return null;
  const variantTag = extractVariantTag(row.title) || "";
  return `${row.titleNormalized}|${row.artistNormalized}|${row.durationBucket}|${variantTag}`;
}

function deterministicFingerprintInternalId(key: string) {
  return `fp_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.serviceTrack.findMany({
    where: {
      isrc: null,
      titleNormalized: { not: null },
      artistNormalized: { not: null },
      durationBucket: { not: null },
    },
    select: {
      id: true,
      internalTrackId: true,
      service: true,
      serviceTrackId: true,
      title: true,
      titleNormalized: true,
      artistNormalized: true,
      durationBucket: true,
    },
  });

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = fingerprintKey(row);
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const mergeGroups = Array.from(groups.entries())
    .map(([key, items]) => ({
      key,
      items,
      internalIds: Array.from(new Set(items.map((item) => item.internalTrackId))),
      services: Array.from(new Set(items.map((item) => item.service))),
    }))
    .filter((group) => group.internalIds.length > 1 && group.services.length > 1);

  console.log(`${apply ? "Applying" : "Dry run:"} ${mergeGroups.length} fingerprint merge groups.`);
  let mergedInternalIds = 0;

  for (const group of mergeGroups) {
    const preferredId = deterministicFingerprintInternalId(group.key);
    const sinkId = group.internalIds.includes(preferredId) ? preferredId : group.internalIds.slice().sort()[0];
    const sourceIds = group.internalIds.filter((id) => id !== sinkId);
    console.log(`- ${group.items[0].title} => ${sinkId} (${group.internalIds.length} internal tracks, ${group.items.length} service tracks)`);
    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      for (const sourceId of sourceIds) {
        await tx.$executeRaw`
          DELETE FROM "TrackMatch" src
          USING "TrackMatch" dst
          WHERE src."internalTrackId" = ${sourceId}
            AND dst."internalTrackId" = ${sinkId}
            AND (
              (src."spotifyServiceTrackId" IS NOT NULL AND src."spotifyServiceTrackId" = dst."spotifyServiceTrackId")
              OR (src."youtubeServiceTrackId" IS NOT NULL AND src."youtubeServiceTrackId" = dst."youtubeServiceTrackId")
              OR (src."soundcloudServiceTrackId" IS NOT NULL AND src."soundcloudServiceTrackId" = dst."soundcloudServiceTrackId")
            )
        `;
        await tx.trackMatch.updateMany({
          where: { internalTrackId: sourceId },
          data: { internalTrackId: sinkId },
        });
        await tx.serviceTrack.updateMany({
          where: { internalTrackId: sourceId },
          data: { internalTrackId: sinkId },
        });
        await tx.$executeRaw`
          DELETE FROM "TrackMatchNegativeCache" src
          USING "TrackMatchNegativeCache" dst
          WHERE src."internalTrackId" = ${sourceId}
            AND dst."internalTrackId" = ${sinkId}
            AND src."targetService" = dst."targetService"
        `;
        await tx.trackMatchNegativeCache.updateMany({
          where: { internalTrackId: sourceId },
          data: { internalTrackId: sinkId },
        });
        await tx.internalTrack.deleteMany({
          where: {
            id: sourceId,
            serviceTracks: { none: {} },
            trackMatches: { none: {} },
          },
        });
        mergedInternalIds += 1;
      }
      const sinkTrack = group.items.find((item) => item.internalTrackId === sinkId) ?? group.items[0];
      await tx.internalTrack.update({
        where: { id: sinkId },
        data: {
          canonicalTitle: sinkTrack.title,
          canonicalArtists: JSON.stringify([sinkTrack.artistNormalized]),
        },
      }).catch(() => undefined);
    });
  }

  if (apply) {
    console.log(`Merged ${mergedInternalIds} internal tracks.`);
  } else {
    console.log("No changes written. Re-run with --apply to merge.");
  }
}

main()
  .catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error(`${error.code}: ${error.message}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
