"use client";

import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PlaylistGroupSettingsForm({
  groupId,
  initialName,
  initialMode,
  initialIntervalMinutes,
}: {
  groupId: string;
  initialName: string;
  initialMode: string;
  initialIntervalMinutes: number;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [mode, setMode] = useState(initialMode === "ADD_AND_REMOVE" ? "ADD_AND_REMOVE" : "ADD_ONLY");
  const [intervalMinutes, setIntervalMinutes] = useState(initialIntervalMinutes);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const intervals = Array.from(new Set([5, 15, 30, 60, 120, 360, 720, 1440, initialIntervalMinutes])).sort(
    (a, b) => a - b,
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/playlist-groups/${encodeURIComponent(groupId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode, intervalMinutes }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ ok: false, text: body?.error || `Could not save this group (${response.status}).` });
        return;
      }
      setMessage({
        ok: true,
        text: body?.queuedSources
          ? `Group settings saved. ${body.queuedSources} active source${body.queuedSources === 1 ? " was" : "s were"} queued.`
          : "Group settings saved.",
      });
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Could not save this group." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-line-soft p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="heading-panel">Group behavior</h3>
        <p className="mt-1 text-xs leading-5 text-muted-fg">
          These settings apply to every platform currently enabled as a source.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(11rem,0.55fr)_minmax(10rem,0.45fr)]">
        <label className="block space-y-2">
          <span className="field-label">Group name</span>
          <input name="groupName" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} required className="w-full" />
        </label>
        <label className="block space-y-2">
          <span className="field-label">Sync behavior</span>
          <select name="groupMode" value={mode} onChange={(event) => setMode(event.target.value)} className="w-full">
            <option value="ADD_ONLY">Add new songs only</option>
            <option value="ADD_AND_REMOVE">Add and remove synced songs</option>
          </select>
        </label>
        <label className="block space-y-2">
          <span className="field-label">Check for changes</span>
          <select
            name="groupInterval"
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(Number(event.target.value))}
            className="w-full"
          >
            {intervals.map((minutes) => (
              <option key={minutes} value={minutes}>
                {intervalLabel(minutes)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        {message ? (
          <span role={message.ok ? "status" : "alert"} className={`min-w-0 flex-1 text-xs ${message.ok ? "text-success-fg" : "text-danger-fg"}`}>
            {message.text}
          </span>
        ) : null}
        <button type="submit" disabled={saving || !name.trim()} className="btn btn-primary">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saving ? "Saving…" : "Save group"}
        </button>
      </div>
    </form>
  );
}

function intervalLabel(minutes: number) {
  if (minutes < 60) return `Every ${minutes} minutes`;
  if (minutes === 60) return "Every hour";
  if (minutes < 1440) return `Every ${minutes / 60} hours`;
  return "Every day";
}
