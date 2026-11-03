import { AppShell } from "@/components/AppShell";
import { YouTubeBrowserLab } from "@/components/YouTubeBrowserLab";
import { getSession } from "@/lib/auth/session";
import { getCachedYouTubePlaylists } from "@/lib/services/youtube/youtubeCache";

export default async function YouTubeBrowserPage() {
  const session = await getSession();
  const playlists = session
    ? await getCachedYouTubePlaylists(session.userId)
    : { playlists: [], lastSyncedAt: null, fromCache: true, isStale: true };
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  return (
    <AppShell title="YouTube Music" description="Create, read, search and edit playlists through the saved browser session.">
      <YouTubeBrowserLab
        nowMs={nowMs}
        initialPlaylists={{
          playlists: playlists.playlists,
          lastSyncedAt: playlists.lastSyncedAt?.toISOString() || null,
          fromCache: playlists.fromCache,
          isStale: playlists.isStale,
        }}
      />
    </AppShell>
  );
}
