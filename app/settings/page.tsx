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
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
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
            <div className="panel flex items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium">Delete selected rule</div>
                <div className="text-sm text-[#666a73]">This removes its destinations and sync history cascade data.</div>
              </div>
              <DeleteRuleButton ruleId={selectedRule.id} />
            </div>
          ) : null}
        </div>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Existing rules</h2>
          {rules.map((rule) => <SyncRuleCard key={rule.id} rule={rule} />)}
          <a href="/settings?new=1" className="block rounded-md border border-dashed border-[#bdbdb6] bg-white px-3 py-3 text-center text-sm font-medium">Create another rule</a>
        </section>
      </div>
    </AppShell>
  );
}
