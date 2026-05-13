import { AppShell } from "@/components/AppShell";
import { SoundCloudBrowserLab } from "@/components/SoundCloudBrowserLab";
import { getSession } from "@/lib/auth/session";
import { getCachedSoundCloudPlaylists } from "@/lib/services/soundcloud/soundcloudCache";

export default async function SoundCloudBrowserPage() {
  const session = await getSession();
  const playlists = session
    ? await getCachedSoundCloudPlaylists(session.userId)
    : { playlists: [], lastSyncedAt: null, fromCache: true, isStale: true };

  return (
    <AppShell title="SoundCloud">
      <SoundCloudBrowserLab
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
