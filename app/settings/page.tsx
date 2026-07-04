import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, GitBranch, ListChecks, PlugZap, Plus, RadioTower, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SyncRuleForm } from "@/components/SyncRuleForm";
import { SyncRuleCard } from "@/components/SyncRuleCard";
import { SyncRuleGroupCard } from "@/components/SyncRuleGroupCard";
import { DeleteRuleButton } from "@/components/DeleteRuleButton";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import type { ReactNode } from "react";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ rule?: string; new?: string }> }) {
  const session = await getSession();
  const params = await searchParams;
  const [playlists, rules, groupMembers, runningJobs, recentJobs, pendingReviewCount] = await Promise.all([
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
    prisma.syncJob.findMany({
      where: { status: "RUNNING", syncRule: { userId: session!.userId } },
      select: { id: true, syncRuleId: true, startedAt: true },
      orderBy: { startedAt: "desc" },
    }),
    prisma.syncJob.findMany({
      where: { syncRule: { userId: session!.userId } },
      select: { id: true, syncRuleId: true, status: true, startedAt: true, finishedAt: true, errorMessage: true },
      orderBy: { startedAt: "desc" },
      take: 80,
    }),
    prisma.manualMatchCandidate.count({ where: { userId: session!.userId, status: "PENDING" } }),
  ]);
  const runningByRule = new Map(
    runningJobs.map((job) => [job.syncRuleId, { id: job.id, startedAt: job.startedAt.toISOString() }]),
  );
  const latestJobByRule = new Map<string, { id: string; status: string; startedAt: string; finishedAt: string | null; errorMessage: string | null }>();
  for (const job of recentJobs) {
    if (latestJobByRule.has(job.syncRuleId)) continue;
    latestJobByRule.set(job.syncRuleId, {
      id: job.id,
      status: job.status,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      errorMessage: job.errorMessage,
    });
  }
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
  const enabledSources = rules.filter((rule) => rule.isEnabled).length;
  const destinationCount = rules.reduce((sum, rule) => sum + rule.destinations.filter((destination) => destination.isEnabled).length, 0);
  const failedRuleCount = rules.filter((rule) => {
    const job = latestJobByRule.get(rule.id);
    return job?.status === "FAILED" || job?.status === "PARTIAL_SUCCESS";
  }).length;

  return (
    <AppShell title="Sync groups">
      <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <section className="panel surface-lift animated-sheen relative overflow-hidden p-5">
            <span className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-full bg-[var(--accent)] opacity-80" />
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-fg">
                  <GitBranch size={14} />
                  Linked playlist sync
                </div>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-white">Groups first, source routes underneath</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-fg">
                  A group is one playlist mirrored across platforms. Enable any platform as a source when changes there should flow to the others.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[34rem]">
                <SettingsMetric icon={<GitBranch size={15} />} label="Groups" value={String(ruleGroups.length)} />
                <SettingsMetric icon={<RadioTower size={15} />} label="Sources" value={`${enabledSources}/${rules.length}`} tone={enabledSources ? "ok" : "neutral"} />
                <SettingsMetric icon={<ListChecks size={15} />} label="Targets" value={String(destinationCount)} />
                <SettingsMetric
                  icon={failedRuleCount || pendingReviewCount ? <AlertTriangle size={15} /> : <Activity size={15} />}
                  label={failedRuleCount ? "Issues" : "Review"}
                  value={failedRuleCount ? String(failedRuleCount) : String(pendingReviewCount)}
                  tone={failedRuleCount || pendingReviewCount ? "warn" : "ok"}
                />
              </div>
            </div>
          </section>
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
                  <div className="text-base font-semibold text-[var(--text)]">Delete selected source route</div>
                  <div className="mt-1 text-sm text-muted-fg">Removes its destinations and sync history.</div>
                </div>
              </div>
              <DeleteRuleButton ruleId={selectedRule.id} />
            </div>
          ) : null}
        </div>
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h2 className="text-lg font-bold text-[var(--text)]">Sync map</h2>
            <span className="pill pill-accent surface-lift">{ruleGroups.length + standaloneRules.length} total</span>
          </div>
          {rules.length ? (
            <>
              {ruleGroups.map((item) =>
                item.group ? (
                  <SyncRuleGroupCard
                    key={item.group.id}
                    groupName={item.group.name}
                    members={item.members}
                    rules={item.rules}
                    runningByRule={runningByRule}
                    latestJobByRule={latestJobByRule}
                  />
                ) : null,
              )}
              {standaloneRules.map((rule) => (
                <SyncRuleCard
                  key={rule.id}
                  rule={rule}
                  runningJob={runningByRule.get(rule.id) ?? null}
                  latestJob={latestJobByRule.get(rule.id) ?? null}
                />
              ))}
            </>
          ) : (
            <div className="panel p-6 text-sm text-center text-muted-fg">No rules yet.</div>
          )}
          <a
            href="/settings?new=1"
            className="group surface-lift animated-sheen relative flex items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed border-[var(--border-soft)] bg-gradient-to-b from-[var(--surface-2)] to-transparent px-4 py-4 text-center text-sm font-semibold text-muted-fg transition duration-200 hover:border-[var(--border-accent)] hover:bg-gradient-to-b hover:from-[var(--accent-soft)] hover:to-transparent hover:text-[var(--accent)]"
          >
            <Plus size={16} className="transition duration-200 group-hover:rotate-90" />
            Create source route
          </a>
        </section>
      </div>
    </AppShell>
  );
}

function SettingsMetric({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass = tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-[#fcd34d]" : "text-[var(--text)]";
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)]/55 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-dim-fg">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-lg font-black tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
