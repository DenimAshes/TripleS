import type { ServiceTrack, SyncJob } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getAdapter, serviceEnum, serviceKey } from "@/lib/services/adapterFactory";
import { syncPlaylistTracksToDb } from "@/lib/services/playlistTracksStore";
import type { NormalizedTrack, ServiceKey } from "./syncTypes";
import { findMatch, rankCandidates } from "./matchEngine";
import { findStoredDestinationMatch, upsertAutoTrackMatch } from "./trackMatchStore";

async function upsertServiceTrack(track: NormalizedTrack) {
  const internal = await prisma.internalTrack.upsert({
    where: { id: `${track.sourceService}_${track.sourceTrackId}` },
    update: {},
    create: {
      id: `${track.sourceService}_${track.sourceTrackId}`,
      canonicalTitle: track.title,
      canonicalArtists: JSON.stringify(track.artists),
      canonicalAlbum: track.album,
      durationMs: track.durationMs,
      isrc: track.isrc,
    },
  });
  return prisma.serviceTrack.upsert({
    where: { service_serviceTrackId: { service: serviceEnum(track.sourceService), serviceTrackId: track.sourceTrackId } },
    update: {
      title: track.title,
      artistsJson: JSON.stringify(track.artists),
      album: track.album,
      durationMs: track.durationMs,
      isrc: track.isrc,
      url: track.url,
    },
    create: {
      internalTrackId: internal.id,
      service: serviceEnum(track.sourceService),
      serviceTrackId: track.sourceTrackId,
      title: track.title,
      artistsJson: JSON.stringify(track.artists),
      album: track.album,
      durationMs: track.durationMs,
      isrc: track.isrc,
      url: track.url,
    },
  });
}

function normalizedFromServiceTrack(track: ServiceTrack): NormalizedTrack {
  return {
    title: track.title,
    artists: JSON.parse(track.artistsJson),
    album: track.album || undefined,
    durationMs: track.durationMs || undefined,
    isrc: track.isrc || undefined,
    sourceService: serviceKey(track.service),
    sourceTrackId: track.serviceTrackId,
    url: track.url || undefined,
    imageUrl: track.imageUrl || undefined,
  };
}

function nextScheduledRun(intervalMinutes: number) {
  return intervalMinutes > 0 ? new Date(Date.now() + intervalMinutes * 60_000) : null;
}

async function getDestinationPlaylist(service: string, servicePlaylistId: string) {
  return prisma.playlist.findUnique({
    where: {
      service_servicePlaylistId: {
        service,
        servicePlaylistId,
      },
    },
  });
}

async function markPlaylistTrackPresent(playlistId: string, serviceTrackId: string, addedBySystem: boolean) {
  const existing = await prisma.playlistTrackState.findFirst({
    where: {
      playlistId,
      serviceTrackId,
      removedAt: null,
    },
  });

  if (existing) {
    await prisma.playlistTrackState.update({
      where: { id: existing.id },
      data: {
        addedBySystem: existing.addedBySystem || addedBySystem,
        lastSeenAt: new Date(),
      },
    });
    return existing;
  }

  const lastPosition = await prisma.playlistTrackState.count({ where: { playlistId } });
  return prisma.playlistTrackState.create({
    data: {
      playlistId,
      serviceTrackId,
      position: lastPosition + 1,
      addedBySystem,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}

async function upsertManualCandidate({
  userId,
  sourceServiceTrackId,
  targetService,
  candidateServiceTrackId,
  confidence,
  alternatives = [],
}: {
  userId: string;
  sourceServiceTrackId: string;
  targetService: string;
  candidateServiceTrackId: string;
  confidence: number;
  alternatives?: Array<{ serviceTrackId: string; confidence: number }>;
}) {
  const existing = await prisma.manualMatchCandidate.findFirst({
    where: {
      userId,
      sourceServiceTrackId,
      targetService,
      candidateServiceTrackId,
    },
  });

  if (existing) {
    if (existing.status === "REJECTED") {
      return { candidate: existing, status: "REJECTED" as const };
    }
    const candidate = await prisma.manualMatchCandidate.update({
      where: { id: existing.id },
      data: {
        confidence: Math.max(existing.confidence, confidence),
        alternativesJson: JSON.stringify(alternatives),
      },
    });
    return { candidate, status: candidate.status };
  }

  const candidate = await prisma.manualMatchCandidate.create({
    data: {
      userId,
      sourceServiceTrackId,
      targetService,
      candidateServiceTrackId,
      confidence,
      alternativesJson: JSON.stringify(alternatives),
      status: "PENDING",
    },
  });
  return { candidate, status: "PENDING" as const };
}

export async function runSync(syncRuleId: string): Promise<SyncJob> {
  const rule = await prisma.syncRule.findUnique({
    where: { id: syncRuleId },
    include: { destinations: { where: { isEnabled: true } } },
  });
  if (!rule) throw new Error("SyncRule not found");

  const job = await prisma.syncJob.create({
    data: {
      syncRuleId,
      status: "RUNNING",
      startedAt: new Date(),
      statsJson: JSON.stringify({ synced: 0, alreadySynced: 0, notFound: 0, manualRequired: 0, removed: 0 }),
    },
  });

  const stats = { synced: 0, alreadySynced: 0, notFound: 0, manualRequired: 0, removed: 0 };
  const sourceAdapter = getAdapter(rule.sourceService, rule.userId);
  const sourceTracks = await sourceAdapter.getPlaylistTracks(rule.sourcePlaylistId);
  const sourcePlaylist = await getDestinationPlaylist(rule.sourceService, rule.sourcePlaylistId);
  const sourceGroupMember = sourcePlaylist
    ? await prisma.playlistGroupMember.findUnique({ where: { playlistId: sourcePlaylist.id } })
    : null;
  const groupId = sourceGroupMember?.groupId;
  const sourceExcludedTrackIds = new Set(
    groupId && sourcePlaylist
      ? (
          await prisma.excludedTrack.findMany({
            where: { groupId, playlistId: sourcePlaylist.id },
            select: { serviceTrackId: true },
          })
        ).map((item) => item.serviceTrackId)
      : [],
  );
  const overrides = groupId
    ? await prisma.trackOverride.findMany({
        where: { groupId },
      })
    : [];
  const overrideBySourceAndService = new Map(overrides.map((item) => [`${item.sourceTrackId}:${item.targetService}`, item.targetTrackId]));
  const serviceExclusions = groupId
    ? await prisma.syncTrackExclusion.findMany({
        where: { groupId },
      })
    : [];
  const excludedSourceAndService = new Set(serviceExclusions.map((item) => `${item.sourceTrackId}:${item.targetService}`));

  try {
    for (const destination of rule.destinations) {
      const targetKey = serviceKey(destination.service);
      const targetAdapter = getAdapter(destination.service, rule.userId);
      const destinationTracks = await targetAdapter.getPlaylistTracks(destination.playlistId);
      const destinationPlaylist = await getDestinationPlaylist(destination.service, destination.playlistId);
      if (destinationPlaylist && !destinationPlaylist.isWritable) {
        continue;
      }
      const destinationExcludedTrackIds = new Set(
        groupId && destinationPlaylist
          ? (
              await prisma.excludedTrack.findMany({
                where: { groupId, playlistId: destinationPlaylist.id },
                select: { serviceTrackId: true },
              })
            ).map((item) => item.serviceTrackId)
          : [],
      );
      const sourceIds = new Set(sourceTracks.map((track) => track.isrc || track.sourceTrackId));

      for (const sourceTrack of sourceTracks) {
        const sourceServiceTrack = await upsertServiceTrack(sourceTrack);
        if (sourceExcludedTrackIds.has(sourceServiceTrack.id)) {
          continue;
        }
        if (excludedSourceAndService.has(`${sourceServiceTrack.id}:${destination.service}`)) {
          continue;
        }
        const overrideTrackId = overrideBySourceAndService.get(`${sourceServiceTrack.id}:${destination.service}`);
        const overrideTrack = overrideTrackId
          ? await prisma.serviceTrack.findUnique({ where: { id: overrideTrackId } })
          : null;
        const existing = destinationTracks.find(
          (track) => (sourceTrack.isrc && track.isrc === sourceTrack.isrc) || track.title === sourceTrack.title,
        );
        const storedMatch = await findStoredDestinationMatch(sourceServiceTrack.internalTrackId, destination.service);
        const match = overrideTrack
          ? { track: normalizedFromServiceTrack(overrideTrack), confidence: 1, source: "manual_override" }
          : existing
            ? { track: existing, confidence: 0.95, source: "playlist" }
            : storedMatch
              ? { track: storedMatch.track, confidence: storedMatch.confidence, source: "stored" }
              : await findMatch(sourceTrack, targetKey, targetAdapter);

        if (match && match.confidence >= 0.9) {
          const targetServiceTrack = await upsertServiceTrack(match.track);
          await upsertAutoTrackMatch({
            internalTrackId: sourceServiceTrack.internalTrackId,
            sourceService: rule.sourceService,
            destinationService: destination.service,
            sourceServiceTrackId: sourceServiceTrack.id,
            targetServiceTrackId: targetServiceTrack.id,
            confidence: match.confidence,
          });

          const state = destinationPlaylist
            ? await prisma.playlistTrackState.findFirst({
                where: {
                  playlistId: destinationPlaylist.id,
                  serviceTrackId: targetServiceTrack.id,
                  removedAt: null,
                },
              })
            : null;
          if (destinationExcludedTrackIds.has(targetServiceTrack.id)) {
            continue;
          }
          const alreadyPresent = Boolean(existing || state);

          if (!alreadyPresent) {
            await targetAdapter.addTrackToPlaylist(destination.playlistId, match.track);
            destinationTracks.push(match.track);
          }
          if (destinationPlaylist) {
            await markPlaylistTrackPresent(destinationPlaylist.id, targetServiceTrack.id, !alreadyPresent);
          }

          const action = alreadyPresent ? "already_synced" : "synced";
          if (alreadyPresent) {
            stats.alreadySynced++;
          } else {
            stats.synced++;
          }

          await prisma.syncLog.create({
            data: {
              syncJobId: job.id,
              level: "INFO",
              action,
              service: destination.service,
              playlistId: destination.playlistId,
              trackTitle: sourceTrack.title,
              message: alreadyPresent
                ? `Already present with ${(match.confidence * 100).toFixed(0)}% confidence`
                : `Added with ${(match.confidence * 100).toFixed(0)}% confidence`,
              metadataJson: JSON.stringify({ confidence: match.confidence, alreadyPresent, matchSource: "source" in match ? match.source : "search" }),
            },
          });
        } else if (match && match.confidence >= 0.65) {
          const searchCandidates = await targetAdapter.searchTrack({
            query: `${sourceTrack.artists.join(" ")} ${sourceTrack.title}`,
            isrc: sourceTrack.isrc,
          });
          const ranked = rankCandidates(sourceTrack, searchCandidates).slice(0, 5);
          const alternativeTracks = await Promise.all(
            ranked.map(async (candidate) => ({
              serviceTrack: await upsertServiceTrack(candidate.track),
              confidence: candidate.confidence,
            })),
          );
          const targetServiceTrack = alternativeTracks[0]?.serviceTrack || (await upsertServiceTrack(match.track));
          const manualCandidate = await upsertManualCandidate({
            userId: rule.userId,
            sourceServiceTrackId: sourceServiceTrack.id,
            targetService: destination.service,
            candidateServiceTrackId: targetServiceTrack.id,
            confidence: match.confidence,
            alternatives: alternativeTracks.map((candidate) => ({
              serviceTrackId: candidate.serviceTrack.id,
              confidence: candidate.confidence,
            })),
          });
          if (manualCandidate.status === "REJECTED") {
            stats.notFound++;
            await prisma.syncLog.create({
              data: {
                syncJobId: job.id,
                level: "WARNING",
                action: "rejected_candidate",
                service: destination.service,
                playlistId: destination.playlistId,
                trackTitle: sourceTrack.title,
                message: "Previously rejected candidate was skipped",
                metadataJson: JSON.stringify({ confidence: match.confidence, candidateId: manualCandidate.candidate.id }),
              },
            });
            continue;
          }

          stats.manualRequired++;
          await prisma.syncLog.create({
            data: {
              syncJobId: job.id,
              level: "WARNING",
              action: "manual_required",
              service: destination.service,
              playlistId: destination.playlistId,
              trackTitle: sourceTrack.title,
              message: `Manual review required at ${(match.confidence * 100).toFixed(0)}% confidence`,
              metadataJson: JSON.stringify({ confidence: match.confidence }),
            },
          });
        } else {
          stats.notFound++;
          await prisma.syncLog.create({
            data: {
              syncJobId: job.id,
              level: "WARNING",
              action: "not_found",
              service: destination.service,
              playlistId: destination.playlistId,
              trackTitle: sourceTrack.title,
              message: "No reliable match found",
              metadataJson: JSON.stringify({ confidence: match?.confidence || 0 }),
            },
          });
        }
      }

      if (rule.mode === "ADD_AND_REMOVE") {
        const removable = destinationTracks.filter((track) => !sourceIds.has(track.isrc || track.sourceTrackId));
        for (const track of removable) {
          const serviceTrack = await upsertServiceTrack({ ...track, sourceService: targetKey as ServiceKey });
          if (destinationExcludedTrackIds.has(serviceTrack.id)) {
            continue;
          }
          const state = destinationPlaylist
            ? await prisma.playlistTrackState.findFirst({
                where: {
                  playlistId: destinationPlaylist.id,
                  serviceTrackId: serviceTrack.id,
                  addedBySystem: true,
                  removedAt: null,
                },
              })
            : null;
          if (state) {
            await targetAdapter.removeTrackFromPlaylist(destination.playlistId, track.sourceTrackId);
            await prisma.playlistTrackState.update({
              where: { id: state.id },
              data: { removedAt: new Date(), lastSeenAt: new Date() },
            });
            stats.removed++;
            await prisma.syncLog.create({
              data: {
                syncJobId: job.id,
                level: "INFO",
                action: "removed",
                service: destination.service,
                playlistId: destination.playlistId,
                trackTitle: track.title,
                message: "Removed system-added track missing from source",
                metadataJson: JSON.stringify({ source: "ADD_AND_REMOVE" }),
              },
            });
          }
        }
      }

      if (destinationPlaylist) {
        await syncPlaylistTracksToDb(rule.userId, targetKey, destination.playlistId).catch(() => {});
      }
    }

    const status = stats.notFound || stats.manualRequired ? "PARTIAL_SUCCESS" : "SUCCESS";
    const finished = await prisma.syncJob.update({
      where: { id: job.id },
      data: { status, finishedAt: new Date(), statsJson: JSON.stringify(stats) },
    });
    await prisma.syncRule.update({
      where: { id: syncRuleId },
      data: {
        lastRunAt: new Date(),
        nextRunAt: nextScheduledRun(rule.intervalMinutes),
      },
    });
    return finished;
  } catch (error) {
    return prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        statsJson: JSON.stringify(stats),
        errorMessage: error instanceof Error ? error.message : "Unknown sync error",
      },
    });
  }
}
