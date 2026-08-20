"use client";

import { Check, ChevronDown, Link2, ListMusic, Loader2, Plus, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { pollBrowserJob, startBrowserJob } from "./browserJobClient";
import { Callout } from "./Callout";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";

export type SyncPlaylistOption = {
  id: string;
  service: string;
  name: string;
  trackCount: number;
  isWritable: boolean;
  isConnected: boolean;
  imageUrl?: string | null;
};

type TargetMode = "existing" | "create";
type TargetState = {
  enabled: boolean;
  mode: TargetMode;
  playlistId: string;
  newName: string;
};

const SERVICES = ["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"];

function serviceKey(service: string) {
  return service.toUpperCase();
}

function defaultTargets(sourceService: string, playlists: SyncPlaylistOption[]): Record<string, TargetState> {
  const source = serviceKey(sourceService);
  return Object.fromEntries(
    SERVICES.filter((service) => service !== source).map((service) => {
      const firstWritable = playlists.find(
        (playlist) => serviceKey(playlist.service) === service && playlist.isWritable && !playlist.isConnected,
      );
      return [
        service,
        {
          enabled: false,
          mode: firstWritable ? "existing" : "create",
          playlistId: firstWritable?.id ?? "",
          newName: "",
        } satisfies TargetState,
      ];
    }),
  );
}

function Artwork({ playlist }: { playlist: SyncPlaylistOption }) {
  if (playlist.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={playlist.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] object-cover ring-1 ring-[var(--border-soft)]" />
    );
  }
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--surface)] text-dim-fg ring-1 ring-[var(--border-soft)]">
      <ListMusic size={16} strokeWidth={1.6} />
    </div>
  );
}

function humanStatus(status: string | null) {
  if (!status) return null;
  if (/creating|connecting/i.test(status)) return "Preparing playlist connection";
  if (/loading source/i.test(status)) return "Loading source playlist";
  if (/reading .* source tracks|opening service playlist|still reading|read \d+ tracks|caching|cached/i.test(status)) {
    return `Reading source tracks - ${status}`;
  }
  if (/starting first sync|running sync/i.test(status)) return "Copying songs to selected services";
  return status;
}

function parseSyncStats(statsJson: string | undefined) {
  if (!statsJson) return null;
  try {
    return JSON.parse(statsJson) as Partial<Record<"synced" | "alreadySynced" | "manualRequired" | "notFound", number>>;
  } catch {
    return null;
  }
}

function syncSummaryFromJobs(jobs: Array<{ statsJson?: string }> | undefined): string | null {
  const total = { synced: 0, alreadySynced: 0, manualRequired: 0, notFound: 0 };
  for (const job of jobs ?? []) {
    const stats = parseSyncStats(job.statsJson);
    if (!stats) continue;
    total.synced += stats.synced ?? 0;
    total.alreadySynced += stats.alreadySynced ?? 0;
    total.manualRequired += stats.manualRequired ?? 0;
    total.notFound += stats.notFound ?? 0;
  }
  const parts = [
    total.synced ? `${total.synced} added` : null,
    total.alreadySynced ? `${total.alreadySynced} already there` : null,
    total.manualRequired ? `${total.manualRequired} to review` : null,
    total.notFound ? `${total.notFound} not found` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function AddPlaylistSyncButton({
  sourcePlaylistId,
  sourceService,
  playlists,
}: {
  sourcePlaylistId: string;
  sourceService: string;
  playlists: SyncPlaylistOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Record<string, TargetState>>(() => defaultTargets(sourceService, playlists));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingReviewCount, setPendingReviewCount] = useState<number | null>(null);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [initialWarnings, setInitialWarnings] = useState<string[]>([]);

  const targetServices = useMemo(() => SERVICES.filter((service) => service !== serviceKey(sourceService)), [sourceService]);
  const enabledServices = targetServices.filter((service) => targets[service]?.enabled);
  const enabledExistingIds = enabledServices
    .map((service) => targets[service])
    .filter((target) => target?.mode === "existing" && target.playlistId)
    .map((target) => target.playlistId);
  const createTargets = enabledServices
    .map((service) => ({ service, target: targets[service] }))
    .filter(({ target }) => target?.mode === "create");
  const canSave =
    enabledServices.length > 0 &&
    createTargets.length <= 1 &&
    enabledServices.every((service) => {
      const target = targets[service];
      if (!target) return false;
      if (target.mode === "existing") return Boolean(target.playlistId);
      return service !== "YOUTUBE" && target.newName.trim().length > 0;
    });

  function setTarget(service: string, patch: Partial<TargetState>) {
    setError(null);
    setPendingReviewCount(null);
    setSyncSummary(null);
    setInitialWarnings([]);
    setTargets((current) => ({ ...current, [service]: { ...current[service], ...patch } }));
  }

  function applyPreset(kind: "youtube" | "soundcloud" | "all") {
    setTargets((current) => {
      const next = { ...current };
      for (const service of targetServices) {
        const shouldEnable =
          kind === "all" ||
          (kind === "youtube" && service === "YOUTUBE") ||
          (kind === "soundcloud" && service === "SOUNDCLOUD");
        next[service] = { ...next[service], enabled: shouldEnable };
      }
      return next;
    });
  }

  async function save() {
    if (!canSave) {
      setError("Choose at least one destination playlist.");
      return;
    }
    setSaving(true);
    setStatus("Queued");
    setError(null);
    setPendingReviewCount(null);
    setSyncSummary(null);
    setInitialWarnings([]);
    try {
      const createDestination = createTargets[0];
      const started = await startBrowserJob("playlistGroup.connect", {
        sourcePlaylistId,
        destinationPlaylistIds: enabledExistingIds,
        createDestination: createDestination
          ? {
              service: createDestination.service,
              name: createDestination.target.newName.trim(),
            }
          : null,
        mode: "ADD_ONLY",
        intervalMinutes: 5,
        isEnabled: true,
        runInitialSync: true,
      });
      setStatus(started.currentStep);
      const finished = await pollBrowserJob(started.id, (job) => setStatus(job.currentStep));
      if (finished.status === "failed" || finished.status === "cancelled") {
        setError(finished.error || "Could not connect playlists.");
        return;
      }
      const reviewCount = finished.result?.initialSync?.pendingReviewCount ?? 0;
      setSyncSummary(syncSummaryFromJobs(finished.result?.initialSync?.syncJobs));
      const warnings = [
        ...(finished.result?.initialSync?.sourceErrors ?? []),
        ...(finished.result?.initialSync?.syncErrors ?? []),
      ].map((item) => `${item.service || "Service"}: ${item.error || "failed"}`);
      setInitialWarnings(warnings);
      if (reviewCount > 0) {
        setPendingReviewCount(reviewCount);
      } else {
        setPendingReviewCount(0);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect playlists.");
    } finally {
      setSaving(false);
      setStatus(null);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary">
        <Link2 size={16} /> Add sync
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-3 backdrop-blur-sm">
          <div className="panel max-h-[calc(100vh-1.5rem)] w-full max-w-4xl overflow-hidden shadow-[var(--shadow-overlay)]">
            <div className="flex items-center justify-between border-b border-[var(--border-soft)] p-4 sm:p-5">
              <div className="min-w-0">
                <div className="eyebrow flex items-center gap-2">
                  <Wand2 size={14} />
                  Sync setup
                </div>
                <h2 className="heading-section mt-1">Choose where this playlist should mirror</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[var(--radius-sm)] p-2 text-muted-fg transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[calc(100vh-8rem)] overflow-auto p-4 sm:p-5">
              <div className="grid gap-2 sm:grid-cols-3">
                <button type="button" onClick={() => applyPreset("youtube")} className="btn btn-ghost justify-center">
                  <ServiceIcon service="YOUTUBE" size="sm" className="h-5 w-5 rounded-[var(--radius-sm)]" />
                  YouTube only
                </button>
                <button type="button" onClick={() => applyPreset("soundcloud")} className="btn btn-ghost justify-center">
                  <ServiceIcon service="SOUNDCLOUD" size="sm" className="h-5 w-5 rounded-[var(--radius-sm)]" />
                  SoundCloud only
                </button>
                <button type="button" onClick={() => applyPreset("all")} className="btn btn-primary justify-center">
                  <Link2 size={16} />
                  Both
                </button>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {targetServices.map((service) => {
                  const meta = serviceMeta(service);
                  const target = targets[service];
                  const options = playlists.filter((playlist) => serviceKey(playlist.service) === service && playlist.id !== sourcePlaylistId);
                  const writableOptions = options.filter((playlist) => playlist.isWritable && !playlist.isConnected);
                  const selectedPlaylist = options.find((playlist) => playlist.id === target?.playlistId);
                  const canCreate = service !== "YOUTUBE";
                  return (
                    <section
                      key={service}
                      className={`relative overflow-hidden rounded-[var(--radius)] border p-4 transition ${
                        target?.enabled ? `${meta.border} bg-[var(--surface-2)]` : "border-[var(--border-soft)] bg-[var(--surface)]"
                      }`}
                    >
                      <span className={`absolute inset-y-3 left-0 w-1 rounded-r-[var(--hairline-radius)] ${meta.bg}`} />
                      <div className="flex items-start justify-between gap-3 pl-1">
                        <div className="flex min-w-0 items-center gap-3">
                          <ServiceIcon service={service} />
                          <div className="min-w-0">
                            <h3 className="heading-row">{meta.label}</h3>
                            <p className="text-sm text-muted-fg">
                              {target?.enabled ? "Tracks will be copied here." : "Not included yet."}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTarget(service, { enabled: !target?.enabled })}
                          className={`inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-sm font-semibold transition ${
                            target?.enabled
                              ? "border-success/40 bg-success text-[var(--text)]"
                              : "border-[var(--border-soft)] bg-[var(--surface-2)] text-muted-fg hover:text-[var(--text)]"
                          }`}
                        >
                          {target?.enabled ? <Check size={15} /> : <Plus size={15} />}
                          {target?.enabled ? "Included" : "Add"}
                        </button>
                      </div>

                      {target?.enabled ? (
                        <div className="mt-4 space-y-3 pl-1">
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setTarget(service, { mode: "existing" })}
                              className={`rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-semibold transition ${
                                target.mode === "existing"
                                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]"
                                  : "border-[var(--border-soft)] bg-[var(--surface)] text-muted-fg"
                              }`}
                            >
                              Existing
                            </button>
                            <button
                              type="button"
                              onClick={() => setTarget(service, { mode: "create" })}
                              disabled={!canCreate}
                              className={`rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                                target.mode === "create"
                                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]"
                                  : "border-[var(--border-soft)] bg-[var(--surface)] text-muted-fg"
                              }`}
                              title={!canCreate ? "Create the YouTube Music playlist there first, then choose it here." : undefined}
                            >
                              Create new
                            </button>
                          </div>

                          {target.mode === "existing" ? (
                            <div className="relative">
                              <select
                                value={target.playlistId}
                                onChange={(event) => setTarget(service, { playlistId: event.target.value })}
                                className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 pr-9 text-sm text-[var(--text)]"
                              >
                                <option value="">Choose playlist</option>
                                {writableOptions.map((playlist) => (
                                  <option key={playlist.id} value={playlist.id}>
                                    {playlist.name} ({playlist.trackCount})
                                  </option>
                                ))}
                              </select>
                              <ChevronDown
                                size={16}
                                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-dim-fg"
                              />
                              {selectedPlaylist ? (
                                <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-soft)] bg-[var(--surface)] p-2">
                                  <Artwork playlist={selectedPlaylist} />
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-[var(--text)]">{selectedPlaylist.name}</div>
                                    <div className="text-xs text-muted-fg">{selectedPlaylist.trackCount} songs</div>
                                  </div>
                                </div>
                              ) : null}
                              {!writableOptions.length ? (
                                <p className="mt-2 text-xs text-warning-fg">
                                  No writable unlinked playlists found for {meta.label}.
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <input
                              value={target.newName}
                              onChange={(event) => setTarget(service, { newName: event.target.value })}
                              placeholder={`New ${meta.label} playlist name`}
                              className="w-full rounded-[var(--radius-sm)] border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 text-sm"
                            />
                          )}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>

              {createTargets.length > 1 ? (
                <div className="mt-4 rounded-[var(--radius-sm)] border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning-fg">
                  Create one new destination at a time. Choose existing playlists for the other service.
                </div>
              ) : null}
              {status ? (
                <div className="mt-4 panel-inset px-3 py-2 text-sm text-muted-fg">
                  <span className="pill pill-accent mr-2">
                    <Loader2 size={12} className="animate-spin" />
                    running
                  </span>
                  {humanStatus(status)}
                </div>
              ) : null}
              {error ? <Callout tone="danger" className="mt-4">{error}</Callout> : null}
              {pendingReviewCount ? (
                <Callout tone="warning" className="mt-4" title={`${pendingReviewCount} songs need review`}>
                  <p className="text-sm">Pick the right versions once, then sync can reuse those choices.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href="/manual-match" className="btn btn-primary">
                      Review songs
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setPendingReviewCount(null);
                        setTargets(defaultTargets(sourceService, playlists));
                      }}
                      className="btn btn-ghost"
                    >
                      Later
                    </button>
                  </div>
                  {initialWarnings.length ? (
                    <div className="mt-3 space-y-1 text-xs opacity-80">
                      {initialWarnings.map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                    </div>
                  ) : null}
                </Callout>
              ) : null}
              {pendingReviewCount === 0 ? (
                <Callout tone="success" className="mt-4" title="Initial sync finished">
                  {syncSummary ? <p className="text-sm">{syncSummary}</p> : null}
                  {initialWarnings.length ? (
                    <div className="mt-3 space-y-1 text-xs opacity-80">
                      {initialWarnings.map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setPendingReviewCount(null);
                        setSyncSummary(null);
                        setInitialWarnings([]);
                        setTargets(defaultTargets(sourceService, playlists));
                      }}
                      className="btn btn-primary"
                    >
                      Done
                    </button>
                  </div>
                </Callout>
              ) : null}

              <div className="mt-5 flex flex-col-reverse gap-2 border-t border-[var(--border-soft)] pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost">
                  Cancel
                </button>
                <button type="button" onClick={save} disabled={saving || !canSave || pendingReviewCount !== null} className="btn btn-primary">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                  {saving ? "Syncing..." : `Start sync${enabledServices.length ? ` (${enabledServices.length})` : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
