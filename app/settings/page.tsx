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
    <AppShell
      title="Sync groups"
      description="A group is one playlist mirrored across platforms. Enable any platform as a source when changes there should flow to the others."
    >
      {/* minmax(0,...) on both tracks: a plain 1fr refuses to shrink below its
          content's intrinsic width, which is what pushed the Sync map column
          past the viewport and clipped every "Run now" button. */}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-9">
        <div className="min-w-0">
          <div className="rows border-y border-[var(--border-soft)]">
            <div className="flex flex-wrap gap-x-9 gap-y-4 py-4">
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
            <Link
              href="/connections"
              className="group flex min-w-0 items-center justify-between gap-4 py-3 text-sm"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-surface-2 text-accent">
                  <PlugZap size={16} />
                </div>
                <div>
                  <div className="heading-row">Need to connect a platform?</div>
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
          </div>
          <SyncRuleForm playlists={playlists} rule={selectedRule} />
          {selectedRule ? (
            <div className="section flex items-center justify-between gap-4 border-t border-[var(--border-soft)] pt-5">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] bg-danger/10 text-danger-fg ring-1 ring-danger/20">
                  <Trash2 size={16} />
                </div>
                <div>
                  <div className="heading-panel">Delete selected source route</div>
                  <div className="mt-1 text-sm text-muted-fg">Removes its destinations and sync history.</div>
                </div>
              </div>
              <DeleteRuleButton ruleId={selectedRule.id} />
            </div>
          ) : null}
        </div>
        <section className="min-w-0 lg:border-l lg:border-[var(--border-soft)] lg:pl-9">
          <div className="section-head">
            <h2 className="heading-section">Sync map</h2>
            <span className="pill pill-accent">{ruleGroups.length + standaloneRules.length} total</span>
          </div>
          {rules.length ? (
            <div className="rows">
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
            </div>
          ) : (
            <p className="py-5 text-sm text-muted-fg">No rules yet.</p>
          )}
          <a
            href="/settings?new=1"
            className="mt-5 flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-line-soft px-4 py-3 text-sm font-medium text-muted-fg transition-colors hover:border-[var(--border-accent)] hover:text-accent"
          >
            <Plus size={16} />
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
  const toneClass = tone === "ok" ? "text-success-fg" : tone === "warn" ? "text-warning-fg" : "text-[var(--text)]";
  return (
    <div className="min-w-20">
      <div className="eyebrow flex items-center gap-1.5 text-muted-fg">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
