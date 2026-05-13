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
    <section className="panel space-y-3 p-4">
      <header className="flex items-center gap-2">
        <Cookie size={18} />
        <h2 className="text-lg font-semibold">Spotify (Web cookie)</h2>
      </header>
      <p className="text-sm text-[#666a73]">
        OAuth для Spotify требует Premium у владельца app. Обход — вставить cookie <code>sp_dc</code> из своего браузера.
        Один раз вставил → видны все плейлисты (включая приватные). Cookie живёт ~год.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-[#666a73]">
        <li>Открой <a href="https://open.spotify.com" target="_blank" rel="noreferrer" className="underline">open.spotify.com</a> и убедись что залогинен.</li>
        <li>F12 → Application → Cookies → <code>https://open.spotify.com</code>.</li>
        <li>Скопируй значение <code>sp_dc</code> и вставь сюда.</li>
      </ol>

      {hasCookie ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Cookie сохранена. Аккаунт: <strong>{serviceUsername || "—"}</strong>
          {connectionStatus ? <> · status: {connectionStatus}</> : null}
          {lastError ? <div className="mt-1 text-xs text-red-700">last error: {lastError}</div> : null}
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Cookie ещё не сохранена.
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium">sp_dc</label>
        <textarea
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          placeholder="AQB..."
          rows={3}
          className="w-full rounded-md border border-[#deded8] px-3 py-2 font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || !cookie.trim()}
            className="rounded-md bg-[#18181b] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Saving..." : hasCookie ? "Replace cookie" : "Save cookie"}
          </button>
          {hasCookie ? (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 disabled:opacity-60"
            >
              <Trash2 size={14} /> Remove
            </button>
          ) : null}
          <button
            type="button"
            onClick={diagnose}
            disabled={busy || !cookie.trim()}
            className="rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm disabled:opacity-60"
          >
            Diagnose
          </button>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {diagnostic ? (
          <pre className="max-h-96 overflow-auto rounded-md bg-[#0f0f12] p-3 text-xs text-[#d8d8d2]">{diagnostic}</pre>
        ) : null}
      </div>
    </section>
  );
}
