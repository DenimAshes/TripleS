import { prisma } from "@/lib/db/prisma";
import { normalizeArtist, normalizeTitle } from "@/lib/utils/normalizeTrack";

const BATCH_SIZE = Math.max(1, Number(process.env.BACKFILL_BATCH_SIZE ?? 500));

function durationBucketOf(durationMs: number | null): number | null {
  if (!durationMs || durationMs <= 0) return null;
  return Math.round(durationMs / 5_000);
}

function parseFirstArtist(artistsJson: string): string {
  try {
    const arr = JSON.parse(artistsJson) as unknown;
    if (Array.isArray(arr) && typeof arr[0] === "string") return arr[0];
  } catch {}
  return "";
}

async function main(): Promise<void> {
  const dryRun = !process.argv.includes("--apply");
  const force = process.argv.includes("--force");

  const where = force
    ? {}
    : {
        OR: [
          { titleNormalized: null },
          { artistNormalized: null },
          { durationBucket: null },
        ],
      };

  const total = await prisma.serviceTrack.count({ where });
  console.log(`[backfill-normalized] ${total} ServiceTrack rows need backfill (force=${force}, dryRun=${dryRun}).`);
  if (!total) return;

  type BatchRow = { id: string; title: string; artistsJson: string; durationMs: number | null };
  let processed = 0;
  let lastId: string | null = null;
  while (true) {
    const batch: BatchRow[] = await prisma.serviceTrack.findMany({
      where: { ...where, ...(lastId ? { id: { gt: lastId } } : {}) },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      select: { id: true, title: true, artistsJson: true, durationMs: true },
    });
    if (!batch.length) break;

    const updates = batch.map((row) => {
      const titleNormalized = normalizeTitle(row.title || "") || null;
      const artistNormalized = normalizeArtist(parseFirstArtist(row.artistsJson)) || null;
      const durationBucket = durationBucketOf(row.durationMs);
      return { id: row.id, titleNormalized, artistNormalized, durationBucket };
    });

    if (!dryRun) {
      await prisma.$transaction(
        updates.map((update) =>
          prisma.serviceTrack.update({
            where: { id: update.id },
            data: {
              titleNormalized: update.titleNormalized,
              artistNormalized: update.artistNormalized,
              durationBucket: update.durationBucket,
            },
          }),
        ),
      );
    }

    processed += batch.length;
    lastId = batch[batch.length - 1].id;
    console.log(`[backfill-normalized] processed ${processed}/${total}${dryRun ? " (dry-run)" : ""}`);
  }

  console.log(`[backfill-normalized] done. ${dryRun ? "Dry-run: re-run with --apply to write." : "Applied."}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
