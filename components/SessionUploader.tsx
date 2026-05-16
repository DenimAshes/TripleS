"use client";

import { useState } from "react";

type SessionInfo = {
  service: string;
  exists: boolean;
  bytes: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

type StaleLevel = "fresh" | "warn" | "stale" | "missing";

function staleLevel(exists: boolean, iso: string | null): StaleLevel {
  if (!exists || !iso) return "missing";
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days >= 14) return "stale";
  if (days >= 7) return "warn";
  return "fresh";
}

const STALE_BADGE: Record<StaleLevel, { label: string; classes: string }> = {
  fresh: { label: "fresh", classes: "pill-success" },
  warn: { label: "ageing", classes: "pill-warning" },
  stale: { label: "stale", classes: "pill-danger" },
  missing: { label: "missing", classes: "" },
};

export function SessionUploader({ initial }: { initial: SessionInfo }) {
  const [info, setInfo] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasted, setPasted] = useState("");

  async function uploadText(text: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${info.service}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const data = (await res.json()) as { error?: string; bytes?: number; updatedBy?: string; hint?: string };
      if (!res.ok) {
        setError(data.error ? `${data.error}${data.hint ? ` — ${data.hint}` : ""}` : `HTTP ${res.status}`);
      } else {
        setInfo({
          service: info.service,
          exists: true,
          bytes: data.bytes ?? 0,
          updatedAt: new Date().toISOString(),
          updatedBy: data.updatedBy ?? null,
        });
        setPasted("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    const text = await file.text();
    await uploadText(text);
  }

  async function submitPasted() {
    const trimmed = pasted.trim();
    if (!trimmed) {
      setError("Paste JSON first.");
      return;
    }
    await uploadText(trimmed);
  }

  async function clear() {
    if (!confirm(`Delete saved ${info.service} session?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${info.service}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setInfo({ ...info, exists: false, bytes: 0, updatedAt: null, updatedBy: null });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`panel p-5 transition ${
        dragOver ? "border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-ring)]" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) upload(file);
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold capitalize">{info.service}</h3>
        {(() => {
          const level = staleLevel(info.exists, info.updatedAt);
          const badge = STALE_BADGE[level];
          return <span className={`pill ${badge.classes}`}>{badge.label}</span>;
        })()}
      </div>
      <dl className="mt-4 space-y-1 text-xs text-muted-fg">
        <div className="flex justify-between">
          <dt>Updated</dt>
          <dd className="text-[var(--text)]">{formatRelative(info.updatedAt)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Size</dt>
          <dd className="text-[var(--text)] tabular-nums">{formatBytes(info.bytes)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>By</dt>
          <dd className="text-[var(--text)]">{info.updatedBy ?? "—"}</dd>
        </div>
      </dl>
      <label className="mt-4 block cursor-pointer rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-center text-sm text-muted-fg transition hover:border-[var(--accent)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">
        <input
          type="file"
          accept="application/json,.json"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
        {busy ? "Uploading…" : "Drop storageState.json or click"}
      </label>
      <details className="mt-3 text-xs text-muted-fg">
        <summary className="cursor-pointer select-none hover:text-[var(--text)]">Or paste JSON</summary>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text) {
              e.preventDefault();
              setPasted(text);
            }
          }}
          placeholder='{ "cookies": [...], "origins": [...] }'
          spellCheck={false}
          rows={4}
          disabled={busy}
          className="mt-2 w-full font-mono text-xs"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={submitPasted}
            disabled={busy || pasted.trim().length === 0}
            className="btn btn-primary text-xs"
          >
            {busy ? "Uploading…" : "Upload pasted JSON"}
          </button>
          {pasted && (
            <button
              type="button"
              onClick={() => setPasted("")}
              disabled={busy}
              className="text-xs text-muted-fg hover:text-[var(--text)] disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
      </details>
      {error && <p className="mt-2 text-xs text-[#fca5a5]">{error}</p>}
      {info.exists && (
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          className="mt-3 text-xs text-muted-fg transition hover:text-[#fca5a5] disabled:opacity-50"
        >
          Delete saved session
        </button>
      )}
    </div>
  );
}
