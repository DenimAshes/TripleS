"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ShortcutNotice = {
  tone: "success" | "error";
  message: string;
  undoId?: string;
};

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function ManualReviewShortcuts({
  reviewId,
  candidateTrackIds,
}: {
  reviewId?: string;
  candidateTrackIds: string[];
}) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ShortcutNotice | null>(null);

  useEffect(() => {
    if (!reviewId) return;

    async function post(endpoint: string, successMessage: string, body?: unknown) {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setNotice(null);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || `Manual review action failed (${response.status})`);
        }
        const scheduledRules = typeof payload?.scheduledRules === "number" ? payload.scheduledRules : 0;
        const syncMessage = scheduledRules > 0
          ? ` Sync queued for ${scheduledRules} source${scheduledRules === 1 ? "" : "s"}.`
          : "";
        setNotice({ tone: "success", message: `${successMessage}${syncMessage}`, undoId: reviewId });
        router.refresh();
      } catch (error) {
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Manual review action failed" });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (busy || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const numericPick = /^[1-5]$/.test(key) ? Number(key) - 1 : -1;
      if (numericPick >= 0) {
        const serviceTrackId = candidateTrackIds[numericPick];
        if (!serviceTrackId) return;
        event.preventDefault();
        void post(`/api/manual-match/${reviewId}/use`, "Match saved. Loading the next song...", { serviceTrackId });
        return;
      }

      if (key === "enter" && candidateTrackIds[0]) {
        event.preventDefault();
        void post(`/api/manual-match/${reviewId}/use`, "Best match saved. Loading the next song...", { serviceTrackId: candidateTrackIds[0] });
      } else if (key === "s") {
        event.preventDefault();
        void post(`/api/manual-match/${reviewId}/reject`, "Song skipped. Loading the next song...");
      } else if (key === "x") {
        event.preventDefault();
        void post(`/api/manual-match/${reviewId}/exclude`, "Song excluded from this destination. Loading the next song...");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, candidateTrackIds, reviewId, router]);

  async function undo() {
    const undoId = notice?.undoId;
    if (!undoId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/manual-match/${undoId}/undo`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `Undo failed (${response.status})`);
      const scheduledRules = typeof payload?.scheduledRules === "number" ? payload.scheduledRules : 0;
      const syncMessage = scheduledRules > 0
        ? ` Sync queued for ${scheduledRules} source${scheduledRules === 1 ? "" : "s"}.`
        : "";
      setNotice({ tone: "success", message: `Restored to review queue.${syncMessage}` });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Undo failed" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!notice && !busy) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm font-semibold shadow-[0_22px_80px_-24px_rgba(0,0,0,0.95)] ${
        notice?.tone === "error"
          ? "border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[var(--danger-soft)] text-[#fecaca]"
          : "border-[color-mix(in_srgb,var(--success)_35%,var(--border))] bg-[var(--success-soft)] text-emerald-200"
      }`}
      role="status"
      aria-live="polite"
    >
      <span>{busy ? "Saving..." : notice?.message}</span>
      {!busy && notice?.undoId ? (
        <button
          type="button"
          onClick={undo}
          className="ml-3 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-2 py-1 text-xs font-black text-[var(--text)] transition hover:border-[var(--border)]"
        >
          Undo
        </button>
      ) : null}
    </div>
  );
}
