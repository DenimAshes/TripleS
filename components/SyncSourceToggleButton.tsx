"use client";

import { Loader2, Power } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncSourceToggleButton({
  ruleId,
  enabled,
  serviceLabel,
}: {
  ruleId: string;
  enabled: boolean;
  serviceLabel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/sync-rules/${encodeURIComponent(ruleId)}/enabled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body?.error || `Could not update ${serviceLabel}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition disabled:opacity-60 ${
          enabled
            ? "border-emerald-500/35 bg-emerald-500/12 text-emerald-200 hover:bg-emerald-500/18"
            : "border-[var(--border-soft)] bg-[var(--surface)] text-dim-fg hover:text-[var(--text)]"
        }`}
        title={enabled ? `${serviceLabel} changes are monitored` : `${serviceLabel} changes are ignored`}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
        {enabled ? "Listening" : "Off"}
      </button>
      {error ? <span className="max-w-44 text-right text-[11px] font-medium text-rose-300">{error}</span> : null}
    </div>
  );
}
