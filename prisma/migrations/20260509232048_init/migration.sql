-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "serviceUserId" TEXT NOT NULL,
    "serviceUsername" TEXT NOT NULL,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "connectionStatus" TEXT NOT NULL DEFAULT 'CONNECTED',
    "lastError" TEXT,
    "webCookieEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "servicePlaylistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "trackCount" INTEGER NOT NULL,
    "isWritable" BOOLEAN NOT NULL,
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceService" TEXT NOT NULL,
    "sourcePlaylistId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "intervalMinutes" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncDestination" (
    "id" TEXT NOT NULL,
    "syncRuleId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL,

    CONSTRAINT "SyncDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalTrack" (
    "id" TEXT NOT NULL,
    "canonicalTitle" TEXT NOT NULL,
    "canonicalArtists" TEXT NOT NULL,
    "canonicalAlbum" TEXT,
    "durationMs" INTEGER,
    "isrc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTrack" (
    "id" TEXT NOT NULL,
    "internalTrackId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "serviceTrackId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artistsJson" TEXT NOT NULL,
    "album" TEXT,
    "durationMs" INTEGER,
    "isrc" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackMatch" (
    "id" TEXT NOT NULL,
    "internalTrackId" TEXT NOT NULL,
    "spotifyServiceTrackId" TEXT,
    "youtubeServiceTrackId" TEXT,
    "soundcloudServiceTrackId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistTrackState" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "serviceTrackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedBySystem" BOOLEAN NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "PlaylistTrackState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "syncRuleId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "statsJson" TEXT NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "trackTitle" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualMatchCandidate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceServiceTrackId" TEXT NOT NULL,
    "targetService" TEXT NOT NULL,
    "candidateServiceTrackId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualMatchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_userId_service_key" ON "ConnectedAccount"("userId", "service");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_service_servicePlaylistId_key" ON "Playlist"("service", "servicePlaylistId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTrack_service_serviceTrackId_key" ON "ServiceTrack"("service", "serviceTrackId");

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRule" ADD CONSTRAINT "SyncRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncDestination" ADD CONSTRAINT "SyncDestination_syncRuleId_fkey" FOREIGN KEY ("syncRuleId") REFERENCES "SyncRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTrack" ADD CONSTRAINT "ServiceTrack_internalTrackId_fkey" FOREIGN KEY ("internalTrackId") REFERENCES "InternalTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackMatch" ADD CONSTRAINT "TrackMatch_internalTrackId_fkey" FOREIGN KEY ("internalTrackId") REFERENCES "InternalTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistTrackState" ADD CONSTRAINT "PlaylistTrackState_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistTrackState" ADD CONSTRAINT "PlaylistTrackState_serviceTrackId_fkey" FOREIGN KEY ("serviceTrackId") REFERENCES "ServiceTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_syncRuleId_fkey" FOREIGN KEY ("syncRuleId") REFERENCES "SyncRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualMatchCandidate" ADD CONSTRAINT "ManualMatchCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
