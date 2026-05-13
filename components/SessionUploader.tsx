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
  fresh: { label: "fresh", classes: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  warn: { label: "ageing", classes: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  stale: { label: "stale", classes: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  missing: { label: "missing", classes: "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400" },
};

export function SessionUploader({ initial }: { initial: SessionInfo }) {
  const [info, setInfo] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
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
      className={`rounded-md border bg-white p-4 transition dark:bg-neutral-950 ${
        dragOver
          ? "border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900"
          : "border-neutral-200 dark:border-neutral-800"
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
        <h3 className="font-medium capitalize text-neutral-900 dark:text-neutral-100">{info.service}</h3>
        {(() => {
          const level = staleLevel(info.exists, info.updatedAt);
          const badge = STALE_BADGE[level];
          return <span className={`rounded-full px-2 py-0.5 text-xs ${badge.classes}`}>{badge.label}</span>;
        })()}
      </div>
      <dl className="mt-3 space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
        <div className="flex justify-between">
          <dt>Updated</dt>
          <dd>{formatRelative(info.updatedAt)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Size</dt>
          <dd>{formatBytes(info.bytes)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>By</dt>
          <dd>{info.updatedBy ?? "—"}</dd>
        </div>
      </dl>
      <label className="mt-4 block cursor-pointer rounded border-2 border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400">
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
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {info.exists && (
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          className="mt-2 text-xs text-neutral-500 hover:text-red-600 disabled:opacity-50 dark:text-neutral-400"
        >
          Delete saved session
        </button>
      )}
    </div>
  );
}
