import { AppShell } from "@/components/AppShell";
import { SyncRuleForm } from "@/components/SyncRuleForm";
import { SyncRuleCard } from "@/components/SyncRuleCard";
import { DeleteRuleButton } from "@/components/DeleteRuleButton";
import { SpotifyCookieConnector } from "@/components/SpotifyCookieConnector";
import { YouTubeBrowserConnector } from "@/components/YouTubeBrowserConnector";
import { SoundCloudConnector } from "@/components/SoundCloudConnector";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { getSpotifyWebCookie } from "@/lib/services/spotify/spotifyCookieStore";
import { stateFilePath } from "@/worker/config";
import fs from "node:fs";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ rule?: string; new?: string }> }) {
  const session = await getSession();
  const params = await searchParams;
  const [playlists, rules, spotifyAccount, spotifyCookie] = await Promise.all([
    prisma.playlist.findMany({ where: { userId: session!.userId }, orderBy: [{ service: "asc" }, { name: "asc" }] }),
    prisma.syncRule.findMany({ where: { userId: session!.userId }, include: { destinations: true }, orderBy: { createdAt: "desc" } }),
    prisma.connectedAccount.findUnique({ where: { userId_service: { userId: session!.userId, service: "SPOTIFY" } } }),
    getSpotifyWebCookie(session!.userId),
  ]);
  const selectedRule = params.new ? undefined : rules.find((rule) => rule.id === params.rule) || rules[0];

  return (
    <AppShell title="Settings">
      <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <SpotifyCookieConnector
            hasCookie={Boolean(spotifyCookie)}
            serviceUsername={spotifyAccount?.serviceUsername}
            connectionStatus={spotifyAccount?.connectionStatus}
            lastError={spotifyAccount?.lastError}
          />
          <YouTubeBrowserConnector
            hasState={fs.existsSync(stateFilePath("youtube"))}
            isBrowserAutomationEnabled={process.env.YOUTUBE_BROWSER_AUTOMATION === "true"}
          />
          <SoundCloudConnector
            hasState={fs.existsSync(stateFilePath("soundcloud"))}
            isEnabled={process.env.SOUNDCLOUD_BROWSER_AUTOMATION === "true"}
          />
          <SyncRuleForm playlists={playlists} rule={selectedRule} />
          {selectedRule ? (
            <div className="panel flex items-center justify-between gap-4 p-6">
              <div>
                <div className="text-base font-semibold text-[var(--text)]">Delete selected rule</div>
                <div className="mt-1 text-sm text-muted-fg">
                  Removes its destinations and sync history.
                </div>
              </div>
              <DeleteRuleButton ruleId={selectedRule.id} />
            </div>
          ) : null}
        </div>
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h2 className="text-lg font-bold text-[var(--text)]">Rules</h2>
            <span className="text-xs font-semibold text-accent-fg uppercase tracking-wider">{rules.length}</span>
          </div>
          {rules.length ? (
            rules.map((rule) => <SyncRuleCard key={rule.id} rule={rule} />)
          ) : (
            <div className="panel p-6 text-sm text-center text-muted-fg">No rules yet.</div>
          )}
          <a
            href="/settings?new=1"
            className="block rounded-lg border border-dashed border-[var(--border-soft)] bg-gradient-to-b from-[var(--surface-2)] to-transparent px-4 py-4 text-center text-sm font-semibold text-muted-fg transition duration-200 hover:border-[var(--border-accent)] hover:bg-gradient-to-b hover:from-[var(--accent-soft)] hover:to-transparent hover:text-[var(--accent)]"
          >
            + Create rule
          </a>
        </section>
      </div>
    </AppShell>
  );
}
