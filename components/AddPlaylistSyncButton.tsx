"use client";

import { Link2, ListMusic, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { pollBrowserJob, startBrowserJob } from "./browserJobClient";
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

function serviceKey(service: string) {
  return service.toUpperCase();
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
  const [activeService, setActiveService] = useState(
    serviceKey(playlists.find((playlist) => serviceKey(playlist.service) !== serviceKey(sourceService) && playlist.isWritable && !playlist.isConnected)?.service || ""),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const services = useMemo(
    () => Array.from(new Set(playlists.filter((playlist) => serviceKey(playlist.service) !== serviceKey(sourceService)).map((playlist) => serviceKey(playlist.service)))),
    [playlists, sourceService],
  );
  const activePlaylists = playlists.filter((playlist) => serviceKey(playlist.service) === activeService && playlist.id !== sourcePlaylistId);

  function toggle(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function save() {
    setSaving(true);
    setStatus("Queued");
    setError(null);
    try {
      const started = await startBrowserJob("playlistGroup.connect", {
        sourcePlaylistId,
        destinationPlaylistIds: selectedIds,
        mode: "ADD_ONLY",
        intervalMinutes: 0,
        isEnabled: true,
      });
      setStatus(started.currentStep);
      const finished = await pollBrowserJob(started.id, (job) => setStatus(job.currentStep));
      if (finished.status === "failed") {
        setError(finished.error || "Could not connect playlists.");
        return;
      }
      setOpen(false);
      setSelectedIds([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect playlists.");
    } finally {
      setSaving(false);
      setStatus(null);
    }
  }

  async function createAndConnect() {
    if (!activeService || !newPlaylistName.trim()) return;
    setSaving(true);
    setStatus("Queued");
    setError(null);
    try {
      const started = await startBrowserJob("playlistGroup.connect", {
        sourcePlaylistId,
        createDestination: {
          service: activeService,
          name: newPlaylistName.trim(),
        },
        mode: "ADD_ONLY",
        intervalMinutes: 0,
        isEnabled: true,
      });
      setStatus(started.currentStep);
      const finished = await pollBrowserJob(started.id, (job) => setStatus(job.currentStep));
      if (finished.status === "failed") {
        setError(finished.error || "Could not create playlist.");
        return;
      }
      setOpen(false);
      setSelectedIds([]);
      setNewPlaylistName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create playlist.");
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="panel w-full max-w-2xl shadow-[0_24px_80px_-20px_rgba(0,0,0,0.7)]">
            <div className="flex items-center justify-between border-b border-[var(--border-soft)] p-5">
              <div>
                <h2 className="text-lg font-semibold">Connect playlist</h2>
                <p className="mt-1 text-sm text-muted-fg">Choose where new songs should be copied.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-muted-fg transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-2">
                {services.map((service) => {
                  const active = activeService === service;
                  const meta = serviceMeta(service);
                  return (
                    <button
                      type="button"
                      key={service}
                      onClick={() => setActiveService(service)}
                      className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                        active
                          ? "border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)] text-[var(--text)]"
                          : "border-[var(--border-soft)] bg-[var(--surface)] text-muted-fg hover:border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <ServiceIcon service={service} size="sm" className="h-5 w-5 rounded-md" />
                        {meta.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="grid max-h-[360px] gap-2 overflow-auto">
                {activePlaylists.map((playlist) => {
                  const disabled = !playlist.isWritable || playlist.isConnected;
                  const checked = selectedIds.includes(playlist.id);
                  return (
                    <label
                      key={playlist.id}
                      className={`rounded-xl border p-3 text-sm transition ${
                        disabled
                          ? "cursor-not-allowed border-[var(--border-soft)] bg-[var(--surface-2)]/50 text-dim-fg"
                          : checked
                          ? "cursor-pointer border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)]"
                          : "cursor-pointer border-[var(--border-soft)] bg-[var(--surface-2)] hover:border-[var(--border)]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(playlist.id)}
                          className="mt-1 !h-4 !w-4 accent-[var(--accent)]"
                        />
                        {playlist.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={playlist.imageUrl}
                            alt=""
                            className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-[var(--border-soft)]"
                          />
                        ) : (
                          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[var(--surface)] text-dim-fg ring-1 ring-[var(--border-soft)]">
                            <ListMusic size={18} strokeWidth={1.5} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{playlist.name}</div>
                          <div className="mt-0.5 text-xs text-muted-fg">
                            <span className="tabular-nums">{playlist.trackCount}</span> songs
                            {playlist.isConnected ? <span className="text-dim-fg"> / already connected</span> : null}
                            {!playlist.isWritable ? <span className="text-dim-fg"> / read-only</span> : null}
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
                {activeService ? (
                  <div className="rounded-xl border border-dashed border-[var(--border)] p-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={newPlaylistName}
                        onChange={(event) => setNewPlaylistName(event.target.value)}
                        placeholder={`New ${serviceMeta(activeService).label} playlist name`}
                        className="min-w-0 flex-1 text-sm"
                      />
                      <button
                        type="button"
                        onClick={createAndConnect}
                        disabled={saving || !newPlaylistName.trim()}
                        className="btn btn-ghost"
                      >
                        <Plus size={16} /> Create new
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="panel-inset p-4 text-sm text-muted-fg">
                    No other platforms are available yet.
                  </div>
                )}
              </div>

              {status ? (
                <div className="panel-inset px-3 py-2 text-sm text-muted-fg">
                  <span className="pill pill-accent mr-2">running</span>
                  {status}
                </div>
              ) : null}
              {error ? (
                <div className="panel-inset border border-[color-mix(in_srgb,var(--danger)_25%,var(--border))] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[#fca5a5]">
                  {error}
                </div>
              ) : null}

              <div className="flex justify-end gap-2 border-t border-[var(--border-soft)] pt-4">
                <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || selectedIds.length === 0}
                  className="btn btn-primary"
                >
                  {saving ? "Saving..." : "Connect"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
