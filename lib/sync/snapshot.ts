import { Prisma, type ServiceTrack } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { bulkUpsertServiceTracks } from "./matchContext";
import type { NormalizedTrack } from "./syncTypes";

const POSITION_UPDATE_BATCH_SIZE = 500;

async function batchUpdatePositions(
  pairs: Array<{ id: string; position: number }>,
  now: Date,
): Promise<void> {
  if (!pairs.length) return;
  for (let offset = 0; offset < pairs.length; offset += POSITION_UPDATE_BATCH_SIZE) {
    const chunk = pairs.slice(offset, offset + POSITION_UPDATE_BATCH_SIZE);
    const rows = chunk.map((pair) => Prisma.sql`(${pair.id}, ${pair.position})`);
    await prisma.$executeRaw`
      UPDATE "PlaylistTrackState" AS s
      SET "position" = v."position",
          "lastSeenAt" = ${now},
          "removedAt" = NULL
      FROM (VALUES ${Prisma.join(rows)}) AS v("id", "position")
      WHERE s."id" = v."id"
    `;
  }
}

const PARTIAL_TOLERANCE = Math.max(
  0,
  Math.min(0.5, Number(process.env.WORKER_SNAPSHOT_PARTIAL_TOLERANCE ?? 0.1)),
);

export class PartialSourceReadError extends Error {
  readonly received: number;
  readonly expected: number;
  constructor(received: number, expected: number) {
    super(`Live source read returned ${received} tracks, expected ~${expected}; refusing to overwrite snapshot.`);
    this.name = "PartialSourceReadError";
    this.received = received;
    this.expected = expected;
  }
}

export function isReadComplete(received: number, expected: number): boolean {
  if (expected <= 0) return true;
  if (received === 0) return false;
  const missing = expected - received;
  const allowedMissing = expected <= 10 ? 1 : Math.ceil(expected * PARTIAL_TOLERANCE);
  return missing <= allowedMissing;
}

export type SnapshotProgressPhase = "serviceTracks" | "cache";
export type SnapshotProgressCallback = (
  phase: SnapshotProgressPhase,
  current: number,
  total: number,
) => void | Promise<void>;

export type WriteSnapshotResult =
  | { stored: true; count: number }
  | { stored: false; reason: string; count: number };

export async function writePlaylistSnapshot(
  playlistId: string,
  tracks: NormalizedTrack[],
  options?: {
    expectedCount?: number;
    allowPartial?: boolean;
    updatePlaylistMeta?: boolean;
    onProgress?: SnapshotProgressCallback;
  },
): Promise<WriteSnapshotResult> {
  const expected = options?.expectedCount ?? 0;
  if (!options?.allowPartial && !isReadComplete(tracks.length, expected)) {
    return { stored: false, reason: `partial-read (${tracks.length}/${expected})`, count: tracks.length };
  }

  const serviceTrackByKey = await bulkUpsertServiceTracks(tracks);
  await options?.onProgress?.("serviceTracks", tracks.length, tracks.length);

  const orderedServiceTracks = tracks
    .map((track) => serviceTrackByKey.get(`${track.sourceService}::${track.sourceTrackId}`))
    .filter((track): track is ServiceTrack => Boolean(track));

  const existingStates = await prisma.playlistTrackState.findMany({
    where: { playlistId, removedAt: null },
    select: { id: true, serviceTrackId: true },
  });
  const stateByServiceTrackId = new Map(existingStates.map((state) => [state.serviceTrackId, state]));
  const now = new Date();
  const creates: Prisma.PlaylistTrackStateCreateManyInput[] = [];
  const updatePairs: Array<{ id: string; position: number }> = [];
  const seenServiceTrackIds = new Set<string>();

  for (let index = 0; index < orderedServiceTracks.length; index += 1) {
    const serviceTrack = orderedServiceTracks[index];
    if (seenServiceTrackIds.has(serviceTrack.id)) continue;
    seenServiceTrackIds.add(serviceTrack.id);
    const existing = stateByServiceTrackId.get(serviceTrack.id);
    if (existing) {
      updatePairs.push({ id: existing.id, position: index + 1 });
    } else {
      creates.push({
        playlistId,
        serviceTrackId: serviceTrack.id,
        position: index + 1,
        addedBySystem: false,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
  }

  await batchUpdatePositions(updatePairs, now);
  if (creates.length) await prisma.playlistTrackState.createMany({ data: creates });

  const staleStateIds = existingStates
    .filter((state) => !seenServiceTrackIds.has(state.serviceTrackId))
    .map((state) => state.id);
  if (staleStateIds.length) {
    await prisma.playlistTrackState.updateMany({
      where: { id: { in: staleStateIds } },
      data: { removedAt: now, lastSeenAt: now },
    });
  }
  await options?.onProgress?.("cache", orderedServiceTracks.length, orderedServiceTracks.length);

  if (options?.updatePlaylistMeta !== false) {
    await prisma.playlist.update({
      where: { id: playlistId },
      data: { trackCount: orderedServiceTracks.length, lastFetchedAt: now },
    });
  }

  return { stored: true, count: orderedServiceTracks.length };
}
