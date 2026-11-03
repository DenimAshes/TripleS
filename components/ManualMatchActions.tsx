"use client";

import { Check, Link, MinusCircle, MoreHorizontal, SkipForward } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useManualMatchLock } from "./ManualMatchLock";

export function ManualMatchActions({
  id,
  serviceTrackId,
  trackTitle,
  targetService,
  compact = false,
  showBestMatch = true,
}: {
  id: string;
  serviceTrackId?: string;
  trackTitle?: string;
  targetService?: string;
  compact?: boolean;
  showBestMatch?: boolean;
}) {
  const router = useRouter();
  const decisionLock = useManualMatchLock();
  const [busy, setBusy] = useState<"accept" | "reject" | "use" | "link" | "exclude" | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleResponse(response: Response, fallback: string) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error || fallback);
    }
    const scheduled = typeof body?.scheduledRules === "number" ? body.scheduledRules : 0;
    setNotice(scheduled > 0 ? `Saved. Sync queued for ${scheduled} source${scheduled === 1 ? "" : "s"}.` : "Saved.");
  }

  async function act(action: "accept" | "reject" | "exclude") {
    if (!decisionLock.acquire()) return;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/manual-match/${id}/${action}`, { method: "POST" });
      await handleResponse(response, `Could not ${action}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
      decisionLock.release();
    }
  }
  async function useThis() {
    if (!serviceTrackId) return;
    if (!decisionLock.acquire()) return;
    setBusy("use");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/manual-match/${id}/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceTrackId }),
      });
      await handleResponse(response, "Could not save song");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
      decisionLock.release();
    }
  }
  async function submitLink() {
    const url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError("Link must start with http:// or https://");
      return;
    }
    if (!decisionLock.acquire()) return;
    setBusy("link");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/manual-match/${id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      await handleResponse(response, `Could not use link (${response.status})`);
      setLinkOpen(false);
      setLinkUrl("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save link");
    } finally {
      setBusy(null);
      decisionLock.release();
    }
  }
  return (
    <div className={compact ? "" : "space-y-2"}>
      {serviceTrackId ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busy) || decisionLock.locked} onClick={useThis} aria-label={trackTitle ? `Use ${trackTitle}` : undefined} className={compact ? "btn btn-primary h-8 px-3 text-xs" : "btn btn-primary"}>
            <Check size={compact ? 13 : 16} />
            {busy === "use" ? "Saving…" : "Use"}
          </button>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap gap-2">
            {showBestMatch ? (
              <button type="button" disabled={Boolean(busy) || decisionLock.locked} onClick={() => act("accept")} className="btn btn-primary">
                <Check size={16} />
                {busy === "accept" ? "Saving…" : "Use best match"}
              </button>
            ) : null}
            <details className="group">
              <summary className="btn btn-ghost list-none marker:content-none">
                <MoreHorizontal size={16} /> Other choices
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={Boolean(busy) || decisionLock.locked} onClick={() => setLinkOpen((open) => !open)} className="btn btn-ghost">
                  <Link size={16} /> {linkOpen ? "Close link" : "Use a link"}
                </button>
                <button type="button" disabled={Boolean(busy) || decisionLock.locked} onClick={() => act("exclude")} className="btn btn-ghost">
                  <MinusCircle size={16} /> {busy === "exclude" ? "Saving…" : "Keep on source only"}
                </button>
                <button type="button" disabled={Boolean(busy) || decisionLock.locked} onClick={() => act("reject")} className="btn btn-ghost">
                  <SkipForward size={16} /> {busy === "reject" ? "Skipping…" : "Skip this song"}
                </button>
              </div>
            </details>
          </div>
        </div>
      )}
      {linkOpen ? (
        <form
          className="flex max-w-xl flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void submitLink();
          }}
        >
          <input
            name="songUrl"
            type="url"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Song link${targetService ? ` for ${targetService}` : ""}`}
            placeholder={`Paste song link${targetService ? ` for ${targetService}` : ""}…`}
            className="min-w-0 flex-1"
          />
          <button disabled={Boolean(busy) || decisionLock.locked} className="btn btn-primary" type="submit">
            {busy === "link" ? "Saving…" : "Save link"}
          </button>
        </form>
      ) : null}
      {notice ? <div role="status" className="text-xs font-medium text-success-fg">{notice}</div> : null}
      {error ? <div role="alert" className="text-xs font-medium text-danger-fg">{error}</div> : null}
    </div>
  );
}
