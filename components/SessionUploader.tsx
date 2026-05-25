"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clipboard, FileJson, ListMusic, Trash2, UploadCloud } from "lucide-react";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";

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

function formatRelative(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const diff = nowMs - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

type StaleLevel = "fresh" | "warn" | "stale" | "missing";

function staleLevel(exists: boolean, iso: string | null, nowMs: number): StaleLevel {
  if (!exists || !iso) return "missing";
  const days = (nowMs - new Date(iso).getTime()) / 86_400_000;
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

function browserRoute(service: string): string | null {
  const normalized = service.toLowerCase();
  if (normalized === "youtube") return "/youtube-browser";
  if (normalized === "soundcloud") return "/soundcloud-browser";
  return null;
}

export function SessionUploader({ initial, cardId }: { initial: SessionInfo; cardId?: string }) {
  const router = useRouter();
  const [info, setInfo] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [pasted, setPasted] = useState("");
  const [nowMs] = useState(() => Date.now());
  const meta = serviceMeta(info.service);
  const level = staleLevel(info.exists, info.updatedAt, nowMs);
  const badge = STALE_BADGE[level];
  const browseHref = browserRoute(info.service);
  const glowClass =
    meta.key === "YOUTUBE" ? "service-glow-youtube" : meta.key === "SOUNDCLOUD" ? "service-glow-soundcloud" : "service-glow-spotify";

  async function uploadText(text: string, sourceLabel: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/sessions/${info.service}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const data = (await res.json()) as { error?: string; bytes?: number; cookies?: number; updatedBy?: string; hint?: string };
      if (!res.ok) {
        setError(data.error ? `${data.error}${data.hint ? ` - ${data.hint}` : ""}` : `HTTP ${res.status}`);
      } else {
        setInfo({
          service: info.service,
          exists: true,
          bytes: data.bytes ?? 0,
          updatedAt: new Date().toISOString(),
          updatedBy: data.updatedBy ?? null,
        });
        setNotice(`Saved ${data.cookies ?? "new"} cookies from ${sourceLabel}.`);
        setPasted("");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    const text = await file.text();
    await uploadText(text, file.name || "selected file");
  }

  async function submitPasted() {
    const trimmed = pasted.trim();
    if (!trimmed) {
      setError("Paste JSON first.");
      return;
    }
    await uploadText(trimmed, "pasted JSON");
  }

  async function clear() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/sessions/${info.service}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setInfo({ ...info, exists: false, bytes: 0, updatedAt: null, updatedBy: null });
        setNotice("Saved session deleted.");
        setDeleteConfirm(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id={cardId}
      className={`panel group surface-lift animated-gradient-frame animated-sheen ${glowClass} relative flex min-h-[360px] scroll-mt-24 flex-col overflow-hidden p-5 md:scroll-mt-8 xl:min-h-[420px] ${meta.border} hover:shadow-[0_28px_70px_-46px_var(--accent-glow)] ${
        dragOver ? "scale-[1.01] border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-ring),0_28px_70px_-46px_var(--accent-glow)]" : ""
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
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-0 transition duration-300 group-hover:opacity-80" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.045),transparent_48%)] opacity-0 transition duration-500 group-hover:opacity-100" />
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <ServiceIcon service={info.service} size="lg" className="transition duration-300 group-hover:scale-105" />
          <div className="min-w-0">
            <h3 className="truncate text-xl font-black tracking-tight text-white">{meta.label}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.16em] text-dim-fg">
              <UploadCloud size={16} />
              Session JSON
            </p>
          </div>
        </div>
        <span className={`pill ${badge.classes}`}>
          {level === "fresh" ? <CheckCircle2 size={13} /> : null}
          {badge.label}
        </span>
      </header>

      <div className="connection-card-pulse mt-5" aria-hidden="true">
        {["JSON", "Session", "Playlists"].map((label, index) => (
          <span
            key={label}
            className={index === 0 || (info.exists && index < 3) ? "is-active" : ""}
            style={{ animationDelay: `${index * 160}ms` }}
          >
            {label}
          </span>
        ))}
      </div>

      <p className="mt-5 text-sm leading-6 text-muted-fg">
        Upload the browser storage state from the logged-in account. Drag a JSON file here or paste the exported JSON.
      </p>

      <dl className="mt-5 grid gap-3 border-y border-[var(--border-soft)] py-4 text-sm sm:grid-cols-3 sm:gap-4">
        <div className="min-w-0">
          <dt className="text-xs uppercase tracking-[0.14em] text-dim-fg">Updated</dt>
          <dd className="mt-1 truncate text-[var(--text)]">{formatRelative(info.updatedAt, nowMs)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs uppercase tracking-[0.14em] text-dim-fg">Size</dt>
          <dd className="mt-1 truncate text-[var(--text)] tabular-nums">{formatBytes(info.bytes)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs uppercase tracking-[0.14em] text-dim-fg">By</dt>
          <dd className="mt-1 truncate text-[var(--text)]">{info.updatedBy ?? "-"}</dd>
        </div>
      </dl>

      <label
        className={`surface-lift animated-sheen relative mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--surface-2)] p-5 text-center text-sm text-muted-fg hover:border-[var(--accent)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] ${
          dragOver ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]" : ""
        }`}
      >
        <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-0 transition duration-300 group-hover:opacity-70" />
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
        {notice ? (
          <CheckCircle2 size={22} className="text-emerald-300 transition duration-200 group-hover:-translate-y-0.5" />
        ) : (
          <UploadCloud size={22} className="transition duration-300 group-hover:-translate-y-0.5 group-hover:scale-110" />
        )}
        <span className="font-medium">{busy ? "Uploading..." : dragOver ? "Drop to upload" : "Drop JSON or click to choose"}</span>
        <span className="inline-flex max-w-full items-center gap-1.5 truncate text-xs text-dim-fg">
          <FileJson size={13} className="shrink-0" />
          Playwright storageState or cookie export
        </span>
      </label>

      <details className="mt-3 text-xs text-muted-fg">
        <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-lg px-1 py-1 transition duration-200 hover:translate-x-0.5 hover:text-[var(--text)]">
          <Clipboard size={13} />
          Paste JSON instead
        </summary>
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
            {busy ? "Uploading..." : "Upload pasted JSON"}
          </button>
          {pasted ? (
            <button
              type="button"
              onClick={() => setPasted("")}
              disabled={busy}
              className="text-xs text-muted-fg hover:text-[var(--text)] disabled:opacity-50"
            >
              Clear
            </button>
          ) : null}
        </div>
      </details>

      {notice ? (
        <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-emerald-200">
          <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </p>
      ) : null}

      {error ? <p className="mt-3 text-xs text-[#fca5a5]">{error}</p> : null}

      <div className="mt-auto grid gap-2 pt-4">
        {info.exists && browseHref ? (
          <Link href={browseHref} className="btn btn-ghost surface-lift group w-full">
            <ListMusic size={16} />
            Browse {meta.shortLabel} playlists
          </Link>
        ) : null}

        {info.exists ? (
          deleteConfirm ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2">
              <div className="text-xs font-medium text-[#fca5a5]">Delete saved {meta.shortLabel} session?</div>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={clear} disabled={busy} className="btn btn-danger text-xs">
                  <Trash2 size={13} />
                  {busy ? "Deleting..." : "Delete"}
                </button>
                <button type="button" onClick={() => setDeleteConfirm(false)} disabled={busy} className="btn btn-ghost text-xs">
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-muted-fg transition hover:bg-red-500/10 hover:text-[#fca5a5] disabled:opacity-50"
            >
              <Trash2 size={13} />
              Delete saved session
            </button>
          )
        ) : null}
      </div>
    </section>
  );
}
