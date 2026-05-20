import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AddPlaylistSyncButton, type SyncPlaylistOption } from "@/components/AddPlaylistSyncButton";
import { PlaylistDiagnosticsCard } from "@/components/PlaylistDiagnosticsCard";
import { PlaylistTracksAutoRefresh } from "@/components/PlaylistTracksAutoRefresh";
import { PlaylistTracksTable, type PlaylistTrackRow } from "@/components/PlaylistTracksTable";
import { RefreshPlaylistTracksButton } from "@/components/RefreshPlaylistTracksButton";
import { ServiceIcon, ServicePill, serviceMeta } from "@/components/ServiceBrand";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { getCachedPlaylistTracks } from "@/lib/services/playlistTracksStore";

const MATCH_FIELDS: Record<string, "spotifyServiceTrackId" | "youtubeServiceTrackId" | "soundcloudServiceTrackId"> = {
  SPOTIFY: "spotifyServiceTrackId",
  YOUTUBE: "youtubeServiceTrackId",
  SOUNDCLOUD: "soundcloudServiceTrackId",
};

export default async function PlaylistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) notFound();
  const { id } = await params;

  const playlist = await prisma.playlist.findUnique({ where: { id } });
  if (!playlist || playlist.userId !== session.userId) notFound();

  const [states, playlists, currentMember, allGroupMembers] = await Promise.all([
    getCachedPlaylistTracks(playlist.id),
    prisma.playlist.findMany({
      where: { userId: session.userId, hidden: false },
      orderBy: [{ service: "asc" }, { name: "asc" }],
    }),
    prisma.playlistGroupMember.findUnique({
      where: { playlistId: playlist.id },
      include: { group: { include: { members: { include: { playlist: true } } } } },
    }),
    prisma.playlistGroupMember.findMany({
      where: { group: { userId: session.userId } },
      select: { playlistId: true },
    }),
  ]);

  const sourceServiceTrackIds = states.map((state) => state.serviceTrackId);
  const pendingReviewCount = sourceServiceTrackIds.length
    ? await prisma.manualMatchCandidate.count({
        where: {
          userId: session.userId,
          status: "PENDING",
          sourceServiceTrackId: { in: sourceServiceTrackIds },
        },
      })
    : 0;

  const connectedPlaylistIds = new Set(allGroupMembers.map((member) => member.playlistId));
  const syncOptions: SyncPlaylistOption[] = playlists.map((item) => ({
    id: item.id,
    service: item.service,
    name: item.name,
    trackCount: item.trackCount,
    isWritable: item.isWritable,
    isConnected: connectedPlaylistIds.has(item.id),
    imageUrl: item.imageUrl,
  }));

  const group = currentMember?.group || null;
  const groupServices = group?.members.map((member) => member.service) || [];
  const internalTrackIds = states.map((state) => state.serviceTrack.internalTrackId);
  const [matches, exclusions] = group
    ? await Promise.all([
        prisma.trackMatch.findMany({
          where: {
            internalTrackId: { in: internalTrackIds },
            status: { in: ["CONFIRMED", "AUTO_MATCHED"] },
          },
          orderBy: { confidence: "desc" },
        }),
        prisma.excludedTrack.findMany({
          where: { groupId: group.id, playlistId: playlist.id },
          select: { serviceTrackId: true },
        }),
      ])
    : [[], []];
  const excludedIds = new Set(exclusions.map((excluded) => excluded.serviceTrackId));
  const matchedServicesByInternalTrack = new Map<string, Set<string>>();
  for (const match of matches) {
    for (const service of groupServices) {
      const field = MATCH_FIELDS[service];
      if (!field || !match[field]) continue;
      const services = matchedServicesByInternalTrack.get(match.internalTrackId) || new Set<string>();
      services.add(service);
      matchedServicesByInternalTrack.set(match.internalTrackId, services);
    }
  }

  const trackRows: PlaylistTrackRow[] = states.map((state) => ({
    id: state.id,
    position: state.position,
    title: state.serviceTrack.title,
    artists: (JSON.parse(state.serviceTrack.artistsJson) as string[]).join(", "),
    album: state.serviceTrack.album,
    durationMs: state.serviceTrack.durationMs,
    imageUrl: state.serviceTrack.imageUrl,
    url: state.serviceTrack.url,
    playlistId: playlist.id,
    serviceTrackId: state.serviceTrackId,
    groupId: group?.id,
    linkedServices: Array.from(matchedServicesByInternalTrack.get(state.serviceTrack.internalTrackId) || []).filter(
      (service) => service !== playlist.service,
    ),
    missingServices: groupServices.filter(
      (service) => service !== playlist.service && !matchedServicesByInternalTrack.get(state.serviceTrack.internalTrackId)?.has(service),
    ),
    isExcluded: excludedIds.has(state.serviceTrackId),
  }));
  const meta = serviceMeta(playlist.service);

  return (
    <AppShell title={playlist.name}>
      <PlaylistTracksAutoRefresh
        playlistId={playlist.id}
        hasTracks={states.length > 0}
        activeTracks={states.length}
        expectedTracks={playlist.trackCount}
        lastFetchedAt={playlist.lastFetchedAt?.toISOString() || null}
      />

      <div className={`mb-6 overflow-hidden rounded-2xl border bg-[#0d0e12]/70 p-5 ${meta.border}`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            {playlist.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={playlist.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover ring-1 ring-[var(--border-soft)]" />
            ) : (
              <ServiceIcon service={playlist.service} size="lg" className="h-20 w-20 rounded-xl" />
            )}
            <div className="min-w-0">
              <Link href="/playlists" className="inline-flex items-center gap-1 text-sm text-muted-fg hover:text-[var(--text)]">
                <ArrowLeft size={14} /> All playlists
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ServicePill service={playlist.service} />
                <span className="pill">{playlist.trackCount} songs</span>
                <span className={playlist.isWritable ? "pill pill-success" : "pill pill-warning"}>
                  {playlist.isWritable ? "Writable" : "Read only"}
                </span>
              </div>
              <h2 className="mt-3 truncate text-2xl font-black tracking-tight text-white">{playlist.name}</h2>
              {playlist.description ? <p className="mt-2 max-w-2xl text-sm text-muted-fg">{playlist.description}</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <AddPlaylistSyncButton sourcePlaylistId={playlist.id} sourceService={playlist.service} playlists={syncOptions} />
            <RefreshPlaylistTracksButton playlistId={playlist.id} />
          </div>
        </div>
      </div>

      <PlaylistDiagnosticsCard playlist={playlist} activeStates={states.length} />

      {pendingReviewCount > 0 ? (
        <Link
          href="/manual-match"
          className="panel-accent mt-4 flex items-center justify-between gap-4 p-3 transition hover:brightness-110"
        >
          <div className="text-sm">
            <span className="font-semibold text-[var(--text)]">
              {pendingReviewCount} {pendingReviewCount === 1 ? "song needs" : "songs need"} review
            </span>
            <span className="text-muted-fg"> - sync was not sure which match to use.</span>
          </div>
          <span className="shrink-0 text-sm font-medium text-[var(--accent)]">Review</span>
        </Link>
      ) : null}

      {states.length === 0 ? (
        <div className="panel p-6 text-sm text-muted-fg">No songs to show yet.</div>
      ) : (
        <PlaylistTracksTable tracks={trackRows} service={playlist.service} />
      )}
    </AppShell>
  );
}
