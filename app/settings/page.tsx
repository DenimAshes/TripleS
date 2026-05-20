import Link from "next/link";
import { PlugZap } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SyncRuleForm } from "@/components/SyncRuleForm";
import { SyncRuleCard } from "@/components/SyncRuleCard";
import { DeleteRuleButton } from "@/components/DeleteRuleButton";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ rule?: string; new?: string }> }) {
  const session = await getSession();
  const params = await searchParams;
  const [playlists, rules] = await Promise.all([
    prisma.playlist.findMany({ where: { userId: session!.userId, hidden: false }, orderBy: [{ service: "asc" }, { name: "asc" }] }),
    prisma.syncRule.findMany({ where: { userId: session!.userId }, include: { destinations: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const selectedRule = params.new ? undefined : rules.find((rule) => rule.id === params.rule) || rules[0];

  return (
    <AppShell title="Sync rules">
      <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <Link
            href="/connections"
            className="panel-inset flex items-center justify-between gap-4 p-4 text-sm transition hover:border-[var(--border)]"
          >
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--surface)] text-[var(--accent)]">
                <PlugZap size={16} />
              </div>
              <div>
                <div className="font-semibold text-[var(--text)]">Need to connect a platform?</div>
                <div className="mt-0.5 text-xs text-muted-fg">
                  Spotify, YouTube Music and SoundCloud setup now lives on the Connections page.
                </div>
              </div>
            </div>
            <span className="text-xs font-medium text-[var(--accent)]">Open →</span>
          </Link>
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
