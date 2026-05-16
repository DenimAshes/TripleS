"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ManualMatchActions({ id, serviceTrackId, targetService }: { id: string; serviceTrackId?: string; targetService?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "reject" | "use" | "link" | "exclude" | null>(null);
  async function act(action: "accept" | "reject" | "exclude") {
    setBusy(action);
    await fetch(`/api/manual-match/${id}/${action}`, { method: "POST" });
    setBusy(null);
    router.refresh();
  }
  async function useThis() {
    if (!serviceTrackId) return;
    setBusy("use");
    await fetch(`/api/manual-match/${id}/use`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceTrackId }),
    });
    setBusy(null);
    router.refresh();
  }
  async function useLink() {
    const url = window.prompt(`Paste the song link${targetService ? ` for ${targetService}` : ""}`);
    if (!url) return;
    setBusy("link");
    await fetch(`/api/manual-match/${id}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    setBusy(null);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap gap-2">
      {serviceTrackId ? (
        <button disabled={Boolean(busy)} onClick={useThis} className="btn btn-primary">
          {busy === "use" ? "Saving..." : "Use this"}
        </button>
      ) : (
        <button disabled={Boolean(busy)} onClick={() => act("accept")} className="btn btn-primary">
          {busy === "accept" ? "Saving..." : "Use best"}
        </button>
      )}
      {!serviceTrackId ? (
        <>
          <button disabled={Boolean(busy)} onClick={useLink} className="btn btn-ghost">
            {busy === "link" ? "Saving..." : "Use link"}
          </button>
          <button disabled={Boolean(busy)} onClick={() => act("exclude")} className="btn btn-ghost">
            {busy === "exclude" ? "Saving..." : "Don't sync"}
          </button>
        </>
      ) : null}
      <button disabled={Boolean(busy)} onClick={() => act("reject")} className="btn btn-ghost">
        {busy === "reject" ? "Skipping..." : "Skip"}
      </button>
    </div>
  );
}
