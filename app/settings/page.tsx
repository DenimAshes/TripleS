import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, ListMusic, Plus, RadioTower, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Callout } from "@/components/Callout";
import { DeleteRuleButton } from "@/components/DeleteRuleButton";
import { PlaylistGroupSettingsForm } from "@/components/PlaylistGroupSettingsForm";
import { ServiceIcon, serviceMeta } from "@/components/ServiceBrand";
import { StatusBadge } from "@/components/StatusBadge";
import { SyncRuleForm } from "@/components/SyncRuleForm";
import { SyncSourceToggleButton } from "@/components/SyncSourceToggleButton";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

const SERVICES = ["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"];

function sourceKey(service: string, playlistId: string) {
  return `${service.toUpperCase()}:${playlistId}`;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; rule?: string; new?: string }>;
}) {
  const session = await getSession();
  const params = await searchParams;
  const [playlists, rules, groups, recentJobs] = await Promise.all([
    prisma.playlist.findMany({
      where: { userId: session!.userId, hidden: false },
      orderBy: [{ service: "asc" }, { name: "asc" }],
    }),
    prisma.syncRule.findMany({
      where: { userId: session!.userId },
      include: { destinations: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.playlistGroup.findMany({
      where: { userId: session!.userId },
      include: { members: { include: { playlist: true }, orderBy: { service: "asc" } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.syncJob.findMany({
      where: { syncRule: { userId: session!.userId } },
      select: { id: true, syncRuleId: true, status: true, startedAt: true, errorMessage: true },
      orderBy: { startedAt: "desc" },
      take: 100,
    }),
  ]);

  const groupIdBySource = new Map<string, string>();
  const memberKeysByGroup = new Map<string, Set<string>>();
  for (const group of groups) {
    const memberKeys = new Set<string>();
    for (const member of group.members) {
      const key = sourceKey(member.playlist.service, member.playlist.servicePlaylistId);
      groupIdBySource.set(key, group.id);
      memberKeys.add(key);
    }
    memberKeysByGroup.set(group.id, memberKeys);
  }

  const rulesByGroup = new Map<string, typeof rules>();
  const standaloneRules: typeof rules = [];
  for (const rule of rules) {
    const groupId = groupIdBySource.get(sourceKey(rule.sourceService, rule.sourcePlaylistId));
    const groupMemberKeys = groupId ? memberKeysByGroup.get(groupId) : null;
    const staysInsideGroup = Boolean(
      groupMemberKeys &&
        rule.destinations.length > 0 &&
        rule.destinations.every((destination) => groupMemberKeys.has(sourceKey(destination.service, destination.playlistId))),
    );
    if (!groupId || (rule.direction !== "TWO_WAY" && !staysInsideGroup)) {
      standaloneRules.push(rule);
      continue;
    }
    const rows = rulesByGroup.get(groupId) || [];
    rows.push(rule);
    rulesByGroup.set(groupId, rows);
  }

  const latestJobByRule = new Map<string, (typeof recentJobs)[number]>();
  for (const job of recentJobs) {
    if (!latestJobByRule.has(job.syncRuleId)) latestJobByRule.set(job.syncRuleId, job);
  }

  const selectedGroup = params.rule || params.new ? undefined : groups.find((group) => group.id === params.group) || groups[0];
  const selectedRule = params.new
    ? undefined
    : standaloneRules.find((rule) => rule.id === params.rule) || (!selectedGroup ? standaloneRules[0] : undefined);
  const selectedGroupRules = selectedGroup ? rulesByGroup.get(selectedGroup.id) || [] : [];
  const groupLatestJobs = selectedGroupRules
    .map((rule) => latestJobByRule.get(rule.id))
    .filter((job): job is NonNullable<typeof job> => Boolean(job))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const selectedGroupIssue = groupLatestJobs.find((job) => job.status === "FAILED" || job.status === "PARTIAL_SUCCESS");
  const groupRuleTemplate = selectedGroupRules[0];
  const enabledGroupSources = Array.from(rulesByGroup.values()).flat().filter((rule) => rule.isEnabled).length;

  return (
    <AppShell
      title="Sync groups"
      description="Each group is one playlist represented on several platforms. Choose which copies can send changes."
      actions={
        <Link href="/playlists?groupMode=1" className="btn btn-ghost">
          <Plus size={15} /> Create group
        </Link>
      }
    >
      <div className="grid min-w-0 gap-6 lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0 lg:sticky lg:top-8 lg:self-start">
          <section className="workbench overflow-hidden" aria-labelledby="groups-heading">
            <div className="workbench-header">
              <div>
                <div className="eyebrow text-muted-fg">Automation</div>
                <h2 id="groups-heading" className="heading-panel mt-1">Playlist groups</h2>
              </div>
              <span className="pill pill-accent">{groups.length}</span>
            </div>

            <nav className="p-2" aria-label="Playlist groups">
              {groups.map((group) => {
                const groupRules = rulesByGroup.get(group.id) || [];
                const activeSources = groupRules.filter((rule) => rule.isEnabled).length;
                const hasIssue = groupRules.some((rule) => {
                  const status = latestJobByRule.get(rule.id)?.status;
                  return status === "FAILED" || status === "PARTIAL_SUCCESS";
                });
                const active = selectedGroup?.id === group.id;
                return (
                  <Link
                    key={group.id}
                    href={`/settings?group=${group.id}#group-editor`}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-[var(--radius-sm)] px-3 py-3 transition-colors ${
                      active ? "bg-accent-soft text-[var(--text)]" : "text-muted-fg hover:bg-surface-2 hover:text-[var(--text)]"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{group.name}</span>
                      {hasIssue ? <span className="shrink-0 text-warning-fg"><AlertTriangle size={14} aria-hidden="true" /><span className="sr-only">Needs attention</span></span> : null}
                    </span>
                    <span className="mt-2 flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5">
                        {group.members.map((member) => (
                          <ServiceIcon key={member.id} service={member.service} size="sm" className="h-5 w-5" />
                        ))}
                      </span>
                      <span className="text-xs text-dim-fg">{activeSources}/{groupRules.length} sources on</span>
                    </span>
                  </Link>
                );
              })}
              {!groups.length ? (
                <div className="px-3 py-6 text-sm text-muted-fg">
                  <p>No linked groups yet.</p>
                  <Link href="/playlists?groupMode=1" className="mt-3 inline-flex min-h-8 items-center gap-1 font-semibold text-[var(--accent)]">
                    Link playlists <ArrowRight size={13} />
                  </Link>
                </div>
              ) : null}
            </nav>

            <div className="grid grid-cols-2 border-t border-line-soft text-center text-xs text-muted-fg">
              <div className="border-r border-line-soft px-3 py-3">
                <strong className="block text-base font-semibold tabular-nums text-[var(--text)]">{groups.length}</strong>
                groups
              </div>
              <div className="px-3 py-3">
                <strong className="block text-base font-semibold tabular-nums text-[var(--text)]">{enabledGroupSources}</strong>
                active sources
              </div>
            </div>
          </section>

          {standaloneRules.length || params.new ? (
            <details open={Boolean(params.rule || params.new)} className="group mt-4 rounded-[var(--radius)] border border-line-soft bg-surface">
              <summary className="flex list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
                <span>
                  <span className="heading-row block">One-way copies</span>
                  <span className="text-xs text-muted-fg">Older rules outside a group</span>
                </span>
                <span className="pill">{standaloneRules.length}</span>
              </summary>
              <nav className="border-t border-line-soft p-2" aria-label="One-way copies">
                {standaloneRules.map((rule) => (
                  <Link
                    key={rule.id}
                    href={`/settings?rule=${rule.id}#rule-editor`}
                    aria-current={selectedRule?.id === rule.id ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm ${
                      selectedRule?.id === rule.id ? "bg-accent-soft text-[var(--text)]" : "text-muted-fg hover:bg-surface-2"
                    }`}
                  >
                    <ServiceIcon service={rule.sourceService} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{rule.name}</span>
                  </Link>
                ))}
                <Link href="/settings?new=1#rule-editor" className="mt-1 flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm font-medium text-[var(--accent)] hover:bg-surface-2">
                  <Plus size={14} /> New one-way copy
                </Link>
              </nav>
            </details>
          ) : null}
        </aside>

        {selectedGroup ? (
          <section id="group-editor" className="workbench min-w-0 scroll-mt-6 overflow-hidden">
            <div className="workbench-header flex-col sm:flex-row">
              <div className="min-w-0">
                <div className="eyebrow text-muted-fg">Playlist group</div>
                <h2 className="heading-card mt-1 truncate">{selectedGroup.name}</h2>
                <p className="mt-1 text-sm text-muted-fg">
                  {selectedGroup.members.length} platforms · {selectedGroupRules.filter((rule) => rule.isEnabled).length} can send changes
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedGroupIssue ? (
                  <StatusBadge status={selectedGroupIssue.status.toLowerCase()} />
                ) : selectedGroupRules.length ? (
                  <span className="pill pill-success"><CheckCircle2 size={12} /> Healthy</span>
                ) : (
                  <span className="pill pill-warning"><AlertTriangle size={12} /> Setup needed</span>
                )}
                {selectedGroup.members.length < SERVICES.length ? (
                  <Link
                    href={`/playlists?groupMode=1&editGroup=${selectedGroup.id}&service=${SERVICES.find((service) => !selectedGroup.members.some((member) => member.service === service))}`}
                    className="btn btn-ghost"
                  >
                    <Plus size={14} /> Add platform
                  </Link>
                ) : null}
              </div>
            </div>

            {selectedGroupIssue ? (
              <Callout tone={selectedGroupIssue.status === "FAILED" ? "danger" : "warning"} className="m-4 sm:m-5" title="Latest group issue">
                <span className="line-clamp-2 break-words">{selectedGroupIssue.errorMessage || "The latest copy did not finish completely."}</span>
              </Callout>
            ) : null}

            <div className="p-4 sm:p-5">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h3 className="heading-panel">Platforms</h3>
                  <p className="mt-1 text-xs text-muted-fg">Turn on every platform where edits should flow out to the other copies.</p>
                </div>
              </div>
              <div className="grid gap-3 xl:grid-cols-3">
                {selectedGroup.members.map((member) => {
                  const playlist = member.playlist;
                  const meta = serviceMeta(member.service);
                  const rule = selectedGroupRules.find(
                    (item) => sourceKey(item.sourceService, item.sourcePlaylistId) === sourceKey(playlist.service, playlist.servicePlaylistId),
                  );
                  const destinations = rule?.destinations.filter((destination) => destination.isEnabled) || [];
                  const latestJob = rule ? latestJobByRule.get(rule.id) : null;
                  return (
                    <article key={member.id} className={`${meta.tint} rounded-[var(--radius)] border ${meta.border} bg-surface-2/45 p-4`}>
                      <div className="flex min-w-0 items-start gap-3">
                        <ServiceIcon service={member.service} size="lg" className="h-12 w-12" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-fg"><ServiceIcon service={member.service} size="sm" className="h-4 w-4" /> {meta.shortLabel}</div>
                          <Link href={`/playlists/${playlist.id}`} title={playlist.name} className="mt-1 flex min-h-8 items-center truncate text-sm font-semibold text-[var(--text)] hover:text-[var(--accent-fg)]">{playlist.name}</Link>
                          <div className="mt-0.5 text-xs text-dim-fg">{playlist.trackCount} songs</div>
                          {latestJob && latestJob.status !== "SUCCESS" ? <div className="mt-1.5"><StatusBadge status={latestJob.status.toLowerCase()} /></div> : null}
                        </div>
                      </div>
                      <div className="mt-4 border-t border-line-soft pt-4">
                        {rule ? (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="heading-row">Use as a source</div>
                                <div className="mt-1 text-xs leading-5 text-muted-fg">
                                  {destinations.length
                                    ? `Sends changes to ${destinations.map((destination) => serviceMeta(destination.service).shortLabel).join(" + ")}.`
                                    : "No writable destinations in this group."}
                                </div>
                              </div>
                              <SyncSourceToggleButton ruleId={rule.id} enabled={rule.isEnabled} serviceLabel={meta.label} />
                            </div>
                          </>
                        ) : (
                          <p className="text-xs leading-5 text-muted-fg">This playlist cannot currently send changes to another writable platform.</p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <PlaylistGroupSettingsForm
              key={selectedGroup.id}
              groupId={selectedGroup.id}
              initialName={selectedGroup.name}
              initialMode={groupRuleTemplate?.mode || "ADD_ONLY"}
              initialIntervalMinutes={groupRuleTemplate?.intervalMinutes || 60}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-3 text-xs text-muted-fg sm:px-5">
              <span className="inline-flex items-center gap-1.5"><RadioTower size={13} /> Group changes run as one worker batch.</span>
              <div className="flex items-center gap-3">
                <Link href="/dashboard#playlist-copies" className="inline-flex min-h-8 items-center font-semibold text-[var(--accent)]">View status</Link>
                <Link href="/history" className="inline-flex min-h-8 items-center font-semibold text-[var(--accent)]">Open activity</Link>
              </div>
            </div>
          </section>
        ) : (
          <section id="rule-editor" className="workbench min-w-0 scroll-mt-6 overflow-hidden px-4 sm:px-6">
            {params.new || selectedRule ? (
              <>
                <div className="border-b border-line-soft py-4 text-sm text-muted-fg">
                  <div className="flex items-center gap-2 font-semibold text-[var(--text)]"><ListMusic size={15} /> One-way copy</div>
                  <p className="mt-1">Kept for compatibility. New cross-platform setups should use playlist groups.</p>
                </div>
                <SyncRuleForm playlists={playlists} rule={selectedRule} />
                {selectedRule ? (
                  <div className="flex flex-col gap-4 border-t border-line-soft py-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] bg-danger-soft text-danger-fg"><Trash2 size={16} /></span>
                      <div><div className="heading-row">Delete this one-way copy</div><div className="mt-0.5 text-xs text-muted-fg">Its destinations and run history will be removed.</div></div>
                    </div>
                    <DeleteRuleButton ruleId={selectedRule.id} />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="grid min-h-72 place-items-center p-6 text-center">
                <div>
                  <ServiceIcon service="SPOTIFY" size="lg" className="mx-auto opacity-70" />
                  <h2 className="heading-card mt-4">Create your first sync group</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-fg">Choose matching playlists from two platforms. TripleS will build the source controls automatically.</p>
                  <Link href="/playlists?groupMode=1" className="btn btn-primary mt-5"><Plus size={15} /> Choose playlists</Link>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
