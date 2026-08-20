import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock3, Link2, Lock, ListMusic, Sparkles } from "lucide-react";
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
import { parseArtistsJson } from "@/lib/utils/parseArtists";

const MATCH_FIELDS: Record<string, "spotifyServiceTrackId" | "youtubeServiceTrackId" | "soundcloudServiceTrackId"> = {
  SPOTIFY: "spotifyServiceTrackId",
  YOUTUBE: "youtubeServiceTrackId",
  SOUNDCLOUD: "soundcloudServiceTrackId",
};

function relativeFromNow(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

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
    artists: parseArtistsJson(state.serviceTrack.artistsJson).join(", "),
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
  const linkedServices = Array.from(new Set(groupServices.filter((service) => service !== playlist.service)));
  const matchedRows = trackRows.filter((row) => (row.linkedServices?.length ?? 0) > 0).length;
  const matchRatio = trackRows.length === 0 ? 0 : Math.round((matchedRows / trackRows.length) * 100);
  const lastFetchedIso = playlist.lastFetchedAt?.toISOString() || null;
  const lastFetchedLabel = lastFetchedIso ? relativeFromNow(lastFetchedIso) : "never";

  return (
    <AppShell title={playlist.name}>
      <PlaylistTracksAutoRefresh
        playlistId={playlist.id}
        hasTracks={states.length > 0}
        activeTracks={states.length}
        expectedTracks={playlist.trackCount}
        lastFetchedAt={lastFetchedIso}
      />

      <section className={`${meta.tint} relative mb-7 border-b border-[var(--border-soft)] pb-6`}>
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            {playlist.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={playlist.imageUrl}
                alt=""
                className="h-20 w-20 shrink-0 rounded-[var(--radius)] object-cover ring-1 ring-[var(--border-soft)]"
              />
            ) : (
              <ServiceIcon service={playlist.service} size="lg" className="h-20 w-20 rounded-[var(--radius)]" />
            )}
            <div className="min-w-0">
              <Link href="/playlists" className="inline-flex items-center gap-1 text-sm text-muted-fg hover:text-[var(--text)]">
                <ArrowLeft size={14} /> All playlists
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ServicePill service={playlist.service} />
                <span className="pill">
                  <ListMusic size={12} />
                  {playlist.trackCount} {playlist.trackCount === 1 ? "song" : "songs"}
                </span>
                <span className={playlist.isWritable ? "pill pill-success" : "pill pill-warning"}>
                  {playlist.isWritable ? "Writable" : <><Lock size={11} /> Read only</>}
                </span>
                <span className="pill">
                  <Clock3 size={12} />
                  fetched {lastFetchedLabel}
                </span>
              </div>
              {/* No playlist name here. AppShell already prints it as this page's
                  h1 a few pixels above, so the hero was showing the same string
                  twice — the one page still doing what the shared header was
                  introduced to stop. */}
              {playlist.description ? <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-fg">{playlist.description}</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <AddPlaylistSyncButton sourcePlaylistId={playlist.id} sourceService={playlist.service} playlists={syncOptions} />
            <RefreshPlaylistTracksButton playlistId={playlist.id} />
          </div>
        </div>

        {group ? (
          <div className="relative mt-6 grid gap-4 border-t border-[var(--border-soft)] pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
            <div className="min-w-0">
              <div className="eyebrow flex items-center gap-1.5">
                <Sparkles size={12} />
                Sync coverage
              </div>
              <p className="mt-1 text-sm text-muted-fg">
                <span className="font-semibold text-[var(--text)]">{matchedRows}</span> of{" "}
                <span className="tabular-nums">{trackRows.length}</span> tracks linked across other services
                <span className="ml-2 text-dim-fg">/ {matchRatio}%</span>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                <div
                  className="dist-bar-fill h-full bg-gradient-to-r from-[var(--accent)] via-[var(--accent-hover)] to-success transition-[width] duration-700"
                  style={{ width: `${matchRatio}%` }}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <span className="eyebrow text-muted-fg">
                <Link2 size={11} className="-mt-0.5 mr-1 inline" />
                Mirrors
              </span>
              {linkedServices.length > 0 ? (
                linkedServices.map((service) => {
                  const sMeta = serviceMeta(service);
                  return (
                    <span key={service} className={`pill ${sMeta.pill}`}>
                      <ServiceIcon service={service} size="sm" className="h-4 w-4" />
                      {sMeta.shortLabel}
                    </span>
                  );
                })
              ) : (
                <span className="pill">No mirrors yet</span>
              )}
            </div>
          </div>
        ) : null}
      </section>

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
        <p className="py-6 text-sm text-muted-fg">No songs to show yet.</p>
      ) : (
        <PlaylistTracksTable tracks={trackRows} service={playlist.service} />
      )}
    </AppShell>
  );
}
