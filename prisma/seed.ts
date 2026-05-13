import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";
import { encryptToken } from "../lib/crypto/tokenEncryption";
import { playlists, soundcloudTracks, spotifyTracks, youtubeTracks } from "../lib/services/mockData";

const prisma = new PrismaClient();

async function createTrack(track: (typeof spotifyTracks)[number]) {
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
    where: {
      service_serviceTrackId: {
        service: track.sourceService.toUpperCase(),
        serviceTrackId: track.sourceTrackId,
      },
    },
    update: {},
    create: {
      internalTrackId: internal.id,
      service: track.sourceService.toUpperCase(),
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

async function main() {
  await prisma.syncLog.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.manualMatchCandidate.deleteMany();
  await prisma.trackMatch.deleteMany();
  await prisma.playlistTrackState.deleteMany();
  await prisma.serviceTrack.deleteMany();
  await prisma.internalTrack.deleteMany();
  await prisma.syncDestination.deleteMany();
  await prisma.syncRule.deleteMany();
  await prisma.playlist.deleteMany();
  await prisma.connectedAccount.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({
    data: {
      email: process.env.ADMIN_EMAIL || "admin@example.com",
      passwordHash: await hashPassword(process.env.ADMIN_PASSWORD || "changeme"),
      name: "Admin",
    },
  });

  for (const service of ["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"] as const) {
    await prisma.connectedAccount.create({
      data: {
        userId: user.id,
        service,
        accessTokenEncrypted: encryptToken(`mock_${service.toLowerCase()}_access`),
        refreshTokenEncrypted: encryptToken(`mock_${service.toLowerCase()}_refresh`),
        expiresAt: new Date(Date.now() + 3600_000),
        serviceUserId: `mock_${service.toLowerCase()}_user`,
        serviceUsername: `${service.toLowerCase()} mock account`,
        isMock: true,
        connectionStatus: "MOCK",
        lastError: null,
      },
    });
  }

  for (const [service, items] of Object.entries(playlists)) {
    for (const item of items) {
      await prisma.playlist.create({
        data: {
          userId: user.id,
          service: service.toUpperCase(),
          servicePlaylistId: item.id,
          name: item.name,
          description: item.description,
          imageUrl: item.imageUrl,
          trackCount: item.trackCount,
          isWritable: item.isWritable,
          lastFetchedAt: new Date(),
        },
      });
    }
  }

  const createdTracks = new Map<string, Awaited<ReturnType<typeof createTrack>>>();
  for (const track of [...spotifyTracks, ...youtubeTracks, ...soundcloudTracks]) {
    createdTracks.set(`${track.sourceService}:${track.sourceTrackId}`, await createTrack(track));
  }

  const rule = await prisma.syncRule.create({
    data: {
      userId: user.id,
      name: "Spotify favorites to video and cloud",
      sourceService: "SPOTIFY",
      sourcePlaylistId: "mock_sp_playlist_favorites",
      mode: "ADD_ONLY",
      direction: "ONE_WAY",
      intervalMinutes: 60,
      isEnabled: true,
      lastRunAt: new Date(Date.now() - 3600_000),
      nextRunAt: new Date(Date.now() + 3600_000),
      destinations: {
        create: [
          { service: "YOUTUBE", playlistId: "mock_yt_playlist_favorites", isEnabled: true },
          { service: "SOUNDCLOUD", playlistId: "mock_sc_playlist_favorites", isEnabled: true },
        ],
      },
    },
  });

  const job = await prisma.syncJob.create({
    data: {
      syncRuleId: rule.id,
      status: "PARTIAL_SUCCESS",
      startedAt: new Date(Date.now() - 12 * 60_000),
      finishedAt: new Date(Date.now() - 11 * 60_000),
      statsJson: JSON.stringify({ synced: 3, notFound: 1, manualRequired: 1 }),
    },
  });

  const logRows = [
    ["INFO", "synced", "YOUTUBE", "mock_yt_playlist_favorites", "Blinding Lights", "Added to YouTube with 95% confidence", 0.95],
    ["INFO", "synced", "YOUTUBE", "mock_yt_playlist_favorites", "Levitating", "Added to YouTube with 91% confidence", 0.91],
    ["WARNING", "manual_required", "YOUTUBE", "mock_yt_playlist_favorites", "Save Your Tears", "Candidate needs manual confirmation", 0.78],
    ["WARNING", "not_found", "SOUNDCLOUD", "mock_sc_playlist_favorites", "As It Was", "No reliable SoundCloud match found", 0.45],
    ["INFO", "synced", "SOUNDCLOUD", "mock_sc_playlist_favorites", "Flowers", "Added to SoundCloud with 93% confidence", 0.93],
  ] as const;

  for (const [level, action, service, playlistId, trackTitle, message, confidence] of logRows) {
    await prisma.syncLog.create({
      data: {
        syncJobId: job.id,
        level,
        action,
        service,
        playlistId,
        trackTitle,
        message,
        metadataJson: JSON.stringify({ confidence }),
      },
    });
  }

  for (const candidate of [
    {
        userId: user.id,
        sourceServiceTrackId: createdTracks.get("spotify:mock_sp_003")!.id,
        targetService: "YOUTUBE",
        candidateServiceTrackId: createdTracks.get("youtube:mock_yt_003")!.id,
        confidence: 0.78,
        status: "PENDING",
      },
      {
        userId: user.id,
        sourceServiceTrackId: createdTracks.get("spotify:mock_sp_004")!.id,
        targetService: "SOUNDCLOUD",
        candidateServiceTrackId: createdTracks.get("soundcloud:mock_sc_003")!.id,
        confidence: 0.72,
        status: "PENDING",
      },
  ]) {
    await prisma.manualMatchCandidate.create({ data: candidate });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
