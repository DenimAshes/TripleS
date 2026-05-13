import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AddPlaylistSyncButton, type SyncPlaylistOption } from "@/components/AddPlaylistSyncButton";
import { PlaylistTracksAutoRefresh } from "@/components/PlaylistTracksAutoRefresh";
import { PlaylistTracksTable, type PlaylistTrackRow } from "@/components/PlaylistTracksTable";
import { RefreshPlaylistTracksButton } from "@/components/RefreshPlaylistTracksButton";
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
      where: { userId: session.userId },
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

  const connectedPlaylistIds = new Set(allGroupMembers.map((member) => member.playlistId));
  const syncOptions: SyncPlaylistOption[] = playlists.map((item) => ({
    id: item.id,
    service: item.service,
    name: item.name,
    trackCount: item.trackCount,
    isWritable: item.isWritable,
    isConnected: connectedPlaylistIds.has(item.id),
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

  return (
    <AppShell title={playlist.name}>
      <PlaylistTracksAutoRefresh
        playlistId={playlist.id}
        hasTracks={states.length > 0}
        lastFetchedAt={playlist.lastFetchedAt?.toISOString() || null}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          {playlist.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={playlist.imageUrl} alt="" className="h-20 w-20 rounded-md object-cover" />
          ) : null}
          <div>
            <Link href="/playlists" className="inline-flex items-center gap-1 text-sm text-[#666a73] hover:underline">
              <ArrowLeft size={14} /> All playlists
            </Link>
            <h2 className="mt-1 text-xl font-semibold">{playlist.name}</h2>
            <p className="mt-1 text-sm text-[#666a73]">
              {playlist.service} · {playlist.trackCount} songs
            </p>
            {playlist.description ? (
              <p className="mt-2 max-w-2xl text-sm text-[#666a73]">{playlist.description}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <AddPlaylistSyncButton sourcePlaylistId={playlist.id} sourceService={playlist.service} playlists={syncOptions} />
          <RefreshPlaylistTracksButton playlistId={playlist.id} />
        </div>
      </div>

      {states.length === 0 ? (
        <div className="panel p-6 text-sm text-[#666a73]">No songs to show yet.</div>
      ) : (
        <PlaylistTracksTable tracks={trackRows} service={playlist.service} />
      )}
    </AppShell>
  );
}
