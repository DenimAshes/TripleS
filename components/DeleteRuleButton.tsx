"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteRuleButton({ ruleId }: { ruleId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/sync-rules/${ruleId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body?.error || `Could not delete this source (${response.status}).`);
        return;
      }
      router.push("/settings");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this source.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-xs font-medium text-danger-fg">Delete this source?</span>
          <button type="button" onClick={remove} disabled={deleting} className="btn btn-danger">
            <Trash2 size={16} /> {deleting ? "Deleting…" : "Confirm delete"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={deleting} className="btn btn-ghost">Keep it</button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="btn btn-danger">
          <Trash2 size={16} /> Delete
        </button>
      )}
      {error ? <span role="alert" className="basis-full text-xs text-danger-fg">{error}</span> : null}
    </div>
  );
}
