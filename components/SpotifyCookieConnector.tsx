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
    <section className="relative overflow-hidden rounded-2xl border border-white/5 bg-[#0d0e12]/80 p-6 backdrop-blur-xl transition-all hover:border-blue-500/20">
      {/* Фоновое свечение */}
      <div className="absolute -top-20 -right-20 h-40 w-40 rounded-full bg-blue-600/10 blur-[80px]" />
      
      <header className="relative z-10 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/10 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.15)]">
          <Cookie size={16} />
        </div>
        <h2 className="text-lg font-bold tracking-tight text-white">Spotify <span className="text-blue-500/80">Web access</span></h2>
      </header>

      <p className="relative z-10 mt-4 text-sm leading-relaxed text-slate-400">
        Используем <code className="text-blue-400">sp_dc</code> для доступа к приватным плейлистам без ограничений OAuth.
      </p>

      <ol className="relative z-10 my-4 space-y-2 text-xs text-slate-500">
        <li className="flex items-start gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/5 text-[10px] text-blue-400">1</span>
          Открой{" "}
          <a href="https://open.spotify.com" target="_blank" rel="noreferrer" className="text-blue-400 underline underline-offset-2 transition-colors hover:text-blue-300">open.spotify.com</a>
        </li>
        <li className="flex items-start gap-2 text-slate-400">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/5 text-[10px] text-blue-400">2</span>
          F12 → Application → Cookies
        </li>
        <li className="flex items-start gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/5 text-[10px] text-blue-400">3</span>
          Вставь значение <code className="text-blue-300">sp_dc</code> ниже.
        </li>
      </ol>

      {hasCookie ? (
        <div className="relative z-10 mb-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
            <span className="text-xs font-medium tracking-widest text-blue-400/80 uppercase">Active Session</span>
            <span className="ml-auto font-mono text-white">
              {serviceUsername || "—"}
            </span>
          </div>
          {lastError ? <div className="mt-2 text-[10px] tracking-tight text-red-400/80 uppercase italic">Error: {lastError}</div> : null}
        </div>
      ) : (
        <div className="relative z-10 mb-4 rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-slate-500">
          Ожидание подключения...
        </div>
      )}

      <div className="relative z-10 space-y-3">
        <label className="block text-[10px] font-bold tracking-widest text-slate-500 uppercase">Cookie Token</label>
        <textarea
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          placeholder="Paste your sp_dc here..."
          rows={3}
          className="w-full rounded-xl border border-white/5 bg-black/40 p-3 font-mono text-xs text-blue-100 transition-all placeholder:text-slate-700 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button 
            type="button" 
            onClick={save} 
            disabled={busy || !cookie.trim()} 
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-[0_0_20px_rgba(37,99,235,0.2)] transition-all hover:bg-blue-500 hover:shadow-blue-500/40 disabled:opacity-50 disabled:grayscale"
          >
            {busy ? "Saving..." : hasCookie ? "Replace cookie" : "Save cookie"}
          </button>
          {hasCookie ? (
            <button type="button" onClick={remove} disabled={busy} className="group flex h-9 w-9 items-center justify-center rounded-xl border border-red-500/10 bg-red-500/5 text-red-500 transition-all hover:bg-red-500 hover:text-white">
              <Trash2 size={14} className="transition-transform group-hover:scale-110" />
            </button>
          ) : null}
          <button type="button" onClick={diagnose} disabled={busy || !cookie.trim()} className="rounded-xl bg-white/5 px-4 py-2.5 text-xs font-bold text-slate-400 transition-all hover:bg-white/10 hover:text-white">
            Test
          </button>
        </div>
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
        {diagnostic ? (
          <pre className="custom-scrollbar max-h-60 overflow-auto rounded-xl border border-white/5 bg-black/60 p-3 font-mono text-[10px] text-blue-300/60">
            {diagnostic}
          </pre>
        ) : null}
      </div>
    </section>
  );
}
