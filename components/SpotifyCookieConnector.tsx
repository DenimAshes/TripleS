"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Trash2 } from "lucide-react";
import { ServiceIcon } from "./ServiceBrand";

type Props = {
  hasCookie: boolean;
  serviceUsername?: string | null;
  connectionStatus?: string | null;
  lastError?: string | null;
};

export function SpotifyCookieConnector({ hasCookie, serviceUsername, lastError }: Props) {
  const router = useRouter();
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/connections/spotify/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: cookie.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError([data.error || `Failed (${response.status})`, data.hint].filter(Boolean).join(" / "));
      } else {
        setMessage(`Connected as ${data.profile.username}. Imported ${data.playlistCount} playlists.`);
        setCookie("");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function diagnose() {
    if (!cookie.trim()) {
      setError("Paste sp_dc first.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    setDiagnostic(null);
    try {
      const response = await fetch("/api/connections/spotify/cookie/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: cookie.trim() }),
      });
      const data = await response.json();
      setDiagnostic(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diagnose failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remove saved Spotify cookie?")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/connections/spotify/cookie", { method: "DELETE" });
      if (!response.ok) setError(`Failed (${response.status})`);
      else {
        setMessage("Cookie removed.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel space-y-4 p-5">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ServiceIcon service="SPOTIFY" />
          <div>
            <h2 className="text-base font-bold text-white">Spotify cookie fallback</h2>
            <p className="mt-1 text-sm text-muted-fg">Paste only the `sp_dc` value or a Cookie-Editor export.</p>
          </div>
        </div>
        <span className={hasCookie ? "pill pill-success" : "pill pill-warning"}>{hasCookie ? "saved" : "empty"}</span>
      </header>

      {hasCookie ? (
        <div className="panel-inset flex items-center gap-2 p-3 text-sm">
          <ClipboardCheck size={16} className="text-emerald-400" />
          <span className="text-muted-fg">
            Current account: <strong className="text-white">{serviceUsername || "unknown"}</strong>
          </span>
        </div>
      ) : null}

      {lastError ? <div className="panel-inset p-3 text-sm text-[#fca5a5]">{lastError}</div> : null}

      <textarea
        value={cookie}
        onChange={(event) => setCookie(event.target.value)}
        placeholder="Paste sp_dc or exported cookie JSON"
        rows={4}
        spellCheck={false}
        className="w-full font-mono text-xs"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={busy || !cookie.trim()} className="btn btn-primary">
          {busy ? "Saving..." : hasCookie ? "Replace cookie" : "Save cookie"}
        </button>
        <button type="button" onClick={diagnose} disabled={busy || !cookie.trim()} className="btn btn-ghost">
          Test
        </button>
        {hasCookie ? (
          <button type="button" onClick={remove} disabled={busy} className="btn btn-danger ml-auto">
            <Trash2 size={14} /> Remove
          </button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-[#fca5a5]">{error}</p> : null}
      {message ? <p className="text-xs text-emerald-400">{message}</p> : null}
      {diagnostic ? (
        <pre className="max-h-60 overflow-auto rounded-xl border border-white/5 bg-black/60 p-3 font-mono text-[10px] text-blue-200/80">
          {diagnostic}
        </pre>
      ) : null}
    </section>
  );
}
