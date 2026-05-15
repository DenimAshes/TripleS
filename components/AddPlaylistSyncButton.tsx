"use client";

import { Link2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { pollBrowserJob, startBrowserJob } from "./browserJobClient";

export type SyncPlaylistOption = {
  id: string;
  service: string;
  name: string;
  trackCount: number;
  isWritable: boolean;
  isConnected: boolean;
};

const SERVICE_LABELS: Record<string, string> = {
  SPOTIFY: "Spotify",
  YOUTUBE: "YouTube Music",
  SOUNDCLOUD: "SoundCloud",
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md bg-[#18181b] px-3 py-2 text-sm font-medium text-white"
      >
        <Link2 size={16} /> Add sync
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#deded8] p-4">
              <div>
                <h2 className="text-lg font-semibold">Connect playlist</h2>
                <p className="mt-1 text-sm text-[#666a73]">Choose where this playlist should copy songs.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 hover:bg-[#f0f0ec]" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div className="flex flex-wrap gap-2">
                {services.map((service) => (
                  <button
                    type="button"
                    key={service}
                    onClick={() => setActiveService(service)}
                    className={`rounded-md border px-3 py-2 text-sm font-medium ${
                      activeService === service ? "border-[#18181b] bg-[#18181b] text-white" : "border-[#deded8] bg-white"
                    }`}
                  >
                    {SERVICE_LABELS[service] || service}
                  </button>
                ))}
              </div>

              <div className="grid max-h-[360px] gap-2 overflow-auto">
                {activePlaylists.map((playlist) => {
                  const disabled = !playlist.isWritable || playlist.isConnected;
                  return (
                    <label
                      key={playlist.id}
                      className={`rounded-md border p-3 text-sm ${
                        disabled ? "border-[#eeeeea] bg-[#f8f8f6] text-[#777]" : "border-[#deded8] bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(playlist.id)}
                          disabled={disabled}
                          onChange={() => toggle(playlist.id)}
                          className="mt-1"
                        />
                        <div>
                          <div className="font-medium">{playlist.name}</div>
                          <div className="mt-1 text-xs text-[#666a73]">
                            {playlist.trackCount} songs
                            {playlist.isConnected ? " · already connected" : ""}
                            {!playlist.isWritable ? " · cannot be changed here" : ""}
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
                {activeService ? (
                  <div className="rounded-md border border-dashed border-[#bdbdb6] bg-white p-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={newPlaylistName}
                        onChange={(event) => setNewPlaylistName(event.target.value)}
                        placeholder={`New ${SERVICE_LABELS[activeService] || activeService} playlist name`}
                        className="min-w-0 flex-1 rounded-md border border-[#deded8] px-3 py-2 text-sm outline-none"
                      />
                      <button
                        type="button"
                        onClick={createAndConnect}
                        disabled={saving || !newPlaylistName.trim()}
                        className="inline-flex items-center justify-center gap-2 rounded-md border border-[#18181b] bg-white px-3 py-2 text-sm font-medium disabled:opacity-60"
                      >
                        <Plus size={16} /> Create new playlist
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-[#deded8] bg-white p-4 text-sm text-[#666a73]">
                    No other platforms are available yet.
                  </div>
                )}
              </div>

              {status ? <div className="rounded-md border border-[#deded8] bg-[#f7f7f4] p-3 text-sm text-[#444852]">{status}</div> : null}
              {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

              <div className="flex justify-end gap-2 border-t border-[#deded8] pt-4">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || selectedIds.length === 0}
                  className="rounded-md bg-[#18181b] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
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
