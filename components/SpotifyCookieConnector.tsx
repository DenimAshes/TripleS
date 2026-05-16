"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Cookie, Trash2 } from "lucide-react";

type Props = {
  hasCookie: boolean;
  serviceUsername?: string | null;
  connectionStatus?: string | null;
  lastError?: string | null;
};

export function SpotifyCookieConnector({ hasCookie, serviceUsername, connectionStatus, lastError }: Props) {
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
        setError(data.error || `Failed (${response.status})`);
      } else {
        setMessage(`Connected as ${data.profile.username}. Imported ${data.playlistCount} playlists.${data.refreshError ? ` Warning: ${data.refreshError}` : ""}`);
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
      setError("Paste sp_dc first to diagnose");
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
    if (!confirm("Remove saved sp_dc cookie? Spotify reads will stop working until you paste it again.")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/connections/spotify/cookie", { method: "DELETE" });
      if (!response.ok) {
        setError(`Failed (${response.status})`);
      } else {
        setMessage("Cookie removed.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel space-y-4 p-5">
      <header className="flex items-center gap-2.5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--accent)]">
          <Cookie size={16} />
        </div>
        <h2 className="text-base font-semibold">Spotify (Web cookie)</h2>
      </header>
      <p className="text-sm text-muted-fg">
        OAuth для Spotify требует Premium у владельца app. Обход — вставить cookie{" "}
        <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs">sp_dc</code> из своего браузера.
        Один раз вставил → видны все плейлисты (включая приватные). Cookie живёт ~год.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-fg">
        <li>
          Открой{" "}
          <a
            href="https://open.spotify.com"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            open.spotify.com
          </a>{" "}
          и убедись что залогинен.
        </li>
        <li>
          F12 → Application → Cookies →{" "}
          <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs">https://open.spotify.com</code>.
        </li>
        <li>
          Скопируй значение <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs">sp_dc</code> и
          вставь сюда.
        </li>
      </ol>

      {hasCookie ? (
        <div className="panel-inset p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="pill pill-success">connected</span>
            <span className="text-muted-fg">
              as <strong className="text-[var(--text)]">{serviceUsername || "—"}</strong>
            </span>
          </div>
          {lastError ? <div className="mt-2 text-xs text-[#fca5a5]">last error: {lastError}</div> : null}
        </div>
      ) : (
        <div className="panel-inset p-3 text-sm text-muted-fg">
          <span className="pill pill-warning mr-2">not connected</span>
          Cookie ещё не сохранена.
        </div>
      )}

      <div className="space-y-2.5">
        <label className="block text-xs font-medium uppercase tracking-wider text-muted-fg">sp_dc</label>
        <textarea
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          placeholder="AQB..."
          rows={3}
          className="w-full font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={busy || !cookie.trim()} className="btn btn-primary">
            {busy ? "Saving..." : hasCookie ? "Replace cookie" : "Save cookie"}
          </button>
          {hasCookie ? (
            <button type="button" onClick={remove} disabled={busy} className="btn btn-danger">
              <Trash2 size={14} /> Remove
            </button>
          ) : null}
          <button type="button" onClick={diagnose} disabled={busy || !cookie.trim()} className="btn btn-ghost">
            Diagnose
          </button>
        </div>
        {error ? <p className="text-sm text-[#fca5a5]">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
        {diagnostic ? (
          <pre className="max-h-96 overflow-auto rounded-xl border border-[var(--border-soft)] bg-[#06070b] p-3 font-mono text-xs text-muted-fg">
            {diagnostic}
          </pre>
        ) : null}
      </div>
    </section>
  );
}
