"use client";

import { useState } from "react";
import { KeyRound, Loader2, Trash2, Stethoscope } from "lucide-react";
import { Callout } from "./Callout";

type SaveResult = {
  ok: boolean;
  profile?: { id: string; username?: string };
  playlistCount?: number;
  refreshError?: string | null;
};

type DiagnoseResult = {
  cookieLength: number;
  cookiePreview: string;
  results: Record<string, { status?: number; error?: string; contentType?: string | null }>;
};

// The cookie path has been implemented server-side all along
// (POST /api/connections/spotify/cookie, plus a /test endpoint whose error text
// literally says "Click Diagnose below") but nothing in the UI ever called it,
// so the only way to connect Spotify was OAuth. This is that missing surface.
export function SpotifyCookieLogin({ hasCookie }: { hasCookie: boolean }) {
  const [open, setOpen] = useState(false);
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "delete" | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnoseResult | null>(null);
  const [stored, setStored] = useState(hasCookie);

  async function post(path: string, init?: RequestInit) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cookie }),
      ...init,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || "Request failed"), { hint: data.hint });
    return data;
  }

  async function save() {
    setBusy("save");
    setError(null);
    setSaved(null);
    setDiagnosis(null);
    try {
      const data = (await post("/api/connections/spotify/cookie")) as SaveResult;
      setSaved(data);
      setStored(true);
      setCookie("");
    } catch (err) {
      const e = err as Error & { hint?: string };
      setError({ message: e.message, hint: e.hint });
    } finally {
      setBusy(null);
    }
  }

  async function diagnose() {
    setBusy("test");
    setError(null);
    try {
      setDiagnosis((await post("/api/connections/spotify/cookie/test")) as DiagnoseResult);
    } catch (err) {
      setError({ message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    try {
      await fetch("/api/connections/spotify/cookie", { method: "DELETE" });
      setStored(false);
      setSaved(null);
      setDiagnosis(null);
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 text-left text-xs text-muted-fg underline-offset-2 hover:text-accent hover:underline">
        {stored ? "Manage the saved sp_dc cookie" : "Can't use OAuth? Sign in with an sp_dc cookie"}
      </button>
    );
  }

  return (
    <div className="panel-inset mt-3 space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text)]">
            <KeyRound size={14} className="text-accent" />
            Cookie login
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-fg">
            Paste the <code className="text-[var(--text)]">sp_dc</code> value from a logged-in open.spotify.com tab. A
            Cookie-Editor JSON export or a Playwright storageState file works too.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="shrink-0 text-xs text-muted-fg hover:text-[var(--text)]">
          Hide
        </button>
      </div>

      <textarea
        value={cookie}
        onChange={(event) => setCookie(event.target.value)}
        rows={3}
        spellCheck={false}
        placeholder="sp_dc=... or the exported JSON"
        className="w-full font-mono text-xs"
      />

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy !== null || !cookie.trim()} className="btn btn-primary">
          {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
          Save cookie
        </button>
        <button type="button" onClick={diagnose} disabled={busy !== null || !cookie.trim()} className="btn btn-ghost">
          {busy === "test" ? <Loader2 size={15} className="animate-spin" /> : <Stethoscope size={15} />}
          Diagnose
        </button>
        {stored ? (
          <button type="button" onClick={remove} disabled={busy !== null} className="btn btn-danger">
            {busy === "delete" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Remove
          </button>
        ) : null}
      </div>

      {saved ? (
        <Callout tone="success">
          Connected as <strong className="font-semibold">{saved.profile?.username || saved.profile?.id}</strong>
          {typeof saved.playlistCount === "number" ? <> · {saved.playlistCount} playlists refreshed</> : null}
          {saved.refreshError ? <div className="mt-1 text-warning-fg">Playlist refresh failed: {saved.refreshError}</div> : null}
        </Callout>
      ) : null}

      {error ? (
        <Callout tone="danger" title={error.message}>
          {error.hint}
        </Callout>
      ) : null}

      {diagnosis ? (
        <div className="space-y-1.5 text-xs">
          <div className="text-muted-fg">
            Cookie {diagnosis.cookiePreview} · {diagnosis.cookieLength} chars
          </div>
          {Object.entries(diagnosis.results).map(([url, result]) => (
            <div key={url} className="flex items-start justify-between gap-2 border-t border-line-soft pt-1.5">
              <span className="min-w-0 break-all text-dim-fg">{url.replace("https://open.spotify.com", "")}</span>
              <span
                className={`shrink-0 tabular-nums ${
                  result.error ? "text-danger-fg" : (result.status ?? 0) < 400 ? "text-success-fg" : "text-warning-fg"
                }`}
              >
                {result.error ? "error" : result.status}
              </span>
            </div>
          ))}
          <details className="pt-1">
            <summary className="cursor-pointer text-muted-fg">Raw response</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded-[var(--radius-sm)] bg-[var(--surface)] p-2 text-xs leading-5 text-muted-fg">
              {JSON.stringify(diagnosis.results, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}
