import Link from "next/link";
import { ArrowRight, PlugZap, Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SyncRuleForm } from "@/components/SyncRuleForm";
import { SyncRuleCard } from "@/components/SyncRuleCard";
import { SyncRuleGroupCard } from "@/components/SyncRuleGroupCard";
import { DeleteRuleButton } from "@/components/DeleteRuleButton";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ rule?: string; new?: string }> }) {
  const session = await getSession();
  const params = await searchParams;
  const [playlists, rules, groupMembers] = await Promise.all([
    prisma.playlist.findMany({ where: { userId: session!.userId, hidden: false }, orderBy: [{ service: "asc" }, { name: "asc" }] }),
    prisma.syncRule.findMany({ where: { userId: session!.userId }, include: { destinations: true }, orderBy: { createdAt: "desc" } }),
    prisma.playlistGroupMember.findMany({
      where: { group: { userId: session!.userId } },
      include: {
        group: true,
        playlist: { select: { id: true, service: true, servicePlaylistId: true, name: true } },
      },
      orderBy: { service: "asc" },
    }),
  ]);
  const memberByPlaylistKey = new Map(
    groupMembers.map((member) => [`${member.playlist.service}:${member.playlist.servicePlaylistId}`, member]),
  );
  const groupedRules = new Map<string, typeof rules>();
  const standaloneRules: typeof rules = [];
  for (const rule of rules) {
    const member = memberByPlaylistKey.get(`${rule.sourceService}:${rule.sourcePlaylistId}`);
    if (rule.direction === "TWO_WAY" && member) {
      const rows = groupedRules.get(member.groupId) || [];
      rows.push(rule);
      groupedRules.set(member.groupId, rows);
    } else {
      standaloneRules.push(rule);
    }
  }
  const ruleGroups = Array.from(groupedRules.entries()).map(([groupId, groupRules]) => {
    const members = groupMembers.filter((member) => member.groupId === groupId);
    return {
      group: members[0]?.group,
      members: members.map((member) => ({
        id: member.id,
        service: member.playlist.service,
        name: member.playlist.name,
        servicePlaylistId: member.playlist.servicePlaylistId,
      })),
      rules: groupRules,
    };
  });
  const selectedRule = params.new ? undefined : rules.find((rule) => rule.id === params.rule) || standaloneRules[0] || rules[0];

  return (
    <AppShell title="Sync rules">
      <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <Link
            href="/connections"
            className="panel group surface-lift animated-sheen relative flex items-center justify-between gap-4 overflow-hidden p-4 text-sm transition hover:border-[var(--border)] hover:shadow-[0_18px_36px_-30px_var(--accent-glow)]"
          >
            <span className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-full bg-[var(--accent)] opacity-0 transition duration-300 group-hover:opacity-100" />
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--surface)] text-[var(--accent)] transition duration-200 group-hover:scale-105">
                <PlugZap size={16} />
              </div>
              <div>
                <div className="font-semibold text-[var(--text)]">Need to connect a platform?</div>
                <div className="mt-0.5 text-xs text-muted-fg">
                  Spotify, YouTube Music and SoundCloud setup now lives on the Connections page.
                </div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] transition group-hover:text-[var(--accent-hover)]">
              Open
              <ArrowRight size={13} className="transition duration-200 group-hover:translate-x-0.5" />
            </span>
          </Link>
          <SyncRuleForm playlists={playlists} rule={selectedRule} />
          {selectedRule ? (
            <div className="panel surface-lift flex items-center justify-between gap-4 p-6">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/20">
                  <Trash2 size={16} />
                </div>
                <div>
                  <div className="text-base font-semibold text-[var(--text)]">Delete selected rule</div>
                  <div className="mt-1 text-sm text-muted-fg">Removes its destinations and sync history.</div>
                </div>
              </div>
              <DeleteRuleButton ruleId={selectedRule.id} />
            </div>
          ) : null}
        </div>
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h2 className="text-lg font-bold text-[var(--text)]">Rules</h2>
            <span className="pill pill-accent surface-lift">{ruleGroups.length + standaloneRules.length} total</span>
          </div>
          {rules.length ? (
            <>
              {ruleGroups.map((item) =>
                item.group ? (
                  <SyncRuleGroupCard key={item.group.id} groupName={item.group.name} members={item.members} rules={item.rules} />
                ) : null,
              )}
              {standaloneRules.map((rule) => <SyncRuleCard key={rule.id} rule={rule} />)}
            </>
          ) : (
            <div className="panel p-6 text-sm text-center text-muted-fg">No rules yet.</div>
          )}
          <a
            href="/settings?new=1"
            className="group surface-lift animated-sheen relative flex items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed border-[var(--border-soft)] bg-gradient-to-b from-[var(--surface-2)] to-transparent px-4 py-4 text-center text-sm font-semibold text-muted-fg transition duration-200 hover:border-[var(--border-accent)] hover:bg-gradient-to-b hover:from-[var(--accent-soft)] hover:to-transparent hover:text-[var(--accent)]"
          >
            <Plus size={16} className="transition duration-200 group-hover:rotate-90" />
            Create rule
          </a>
        </section>
      </div>
    </AppShell>
  );
}
