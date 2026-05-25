"use client";

import { Check, Link, MinusCircle, SkipForward } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ManualMatchActions({
  id,
  serviceTrackId,
  targetService,
  compact = false,
}: {
  id: string;
  serviceTrackId?: string;
  targetService?: string;
  compact?: boolean;
}) {
  const router = useRouter();
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
    }
  }
  async function useThis() {
    if (!serviceTrackId) return;
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
    }
  }
  async function submitLink() {
    const url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError("Link must start with http:// or https://");
      return;
    }
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
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className={compact ? "" : "space-y-2"}>
      <div className="flex flex-wrap gap-2">
        {serviceTrackId ? (
          <button disabled={Boolean(busy)} onClick={useThis} className={compact ? "btn btn-primary h-8 px-3 text-xs" : "btn btn-primary"}>
            <Check size={compact ? 13 : 16} />
            {busy === "use" ? "Saving..." : "Use"}
          </button>
        ) : (
          <button disabled={Boolean(busy)} onClick={() => act("accept")} className="btn btn-primary">
            <Check size={16} />
            {busy === "accept" ? "Saving..." : "Use best"}
          </button>
        )}
        {!serviceTrackId ? (
          <>
            <button disabled={Boolean(busy)} onClick={() => setLinkOpen((open) => !open)} className="btn btn-ghost">
              <Link size={16} />
              {linkOpen ? "Close link" : "Use link"}
            </button>
            <button disabled={Boolean(busy)} onClick={() => act("exclude")} className="btn btn-ghost">
              <MinusCircle size={16} />
              {busy === "exclude" ? "Saving..." : "Don't sync"}
            </button>
          </>
        ) : null}
        <button disabled={Boolean(busy)} onClick={() => act("reject")} className={compact ? "btn btn-ghost h-8 px-3 text-xs" : "btn btn-ghost"}>
          <SkipForward size={compact ? 13 : 16} />
          {busy === "reject" ? "Skipping..." : "Skip"}
        </button>
      </div>
      {linkOpen ? (
        <form
          className="flex max-w-xl flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void submitLink();
          }}
        >
          <input
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder={`Paste song link${targetService ? ` for ${targetService}` : ""}`}
            className="min-w-0 flex-1"
          />
          <button disabled={Boolean(busy)} className="btn btn-primary" type="submit">
            {busy === "link" ? "Saving..." : "Save link"}
          </button>
        </form>
      ) : null}
      {notice ? <div className="text-xs font-medium text-emerald-300">{notice}</div> : null}
      {error ? <div className="text-xs font-medium text-rose-300">{error}</div> : null}
    </div>
  );
}
