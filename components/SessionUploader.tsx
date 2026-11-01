"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clipboard, FileJson, ListMusic, Trash2, UploadCloud } from "lucide-react";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";

type SessionInfo = {
  service: string;
  exists: boolean;
  updatedAt: string | null;
  isUsable: boolean;
};

function formatRelative(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const diff = nowMs - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

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
  const [showEditor, setShowEditor] = useState(!initial.isUsable);
  const [nowMs] = useState(() => Date.now());
  const meta = serviceMeta(info.service);
  const badge = !info.exists
    ? { label: "Missing", classes: "" }
    : info.isUsable
      ? { label: "Ready", classes: "pill-success" }
      : { label: "Invalid", classes: "pill-danger" };
  const browseHref = browserRoute(info.service);

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
      const data = (await res.json()) as { error?: string; cookies?: number; hint?: string; isUsable?: boolean };
      if (!res.ok) {
        setError(data.error ? `${data.error}${data.hint ? ` - ${data.hint}` : ""}` : `HTTP ${res.status}`);
      } else {
        setInfo({
          service: info.service,
          exists: true,
          updatedAt: new Date().toISOString(),
          isUsable: data.isUsable === true,
        });
        setNotice(`Saved ${data.cookies ?? "new"} cookies from ${sourceLabel}.`);
        setPasted("");
        setShowEditor(false);
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
        setInfo({ ...info, exists: false, updatedAt: null, isUsable: false });
        setNotice("Saved session deleted.");
        setDeleteConfirm(false);
        setShowEditor(true);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (info.isUsable && !showEditor) {
    return (
      <section id={cardId} className={`panel ${meta.tint} ${meta.border} scroll-mt-24 p-4 md:scroll-mt-8 sm:p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <ServiceIcon service={info.service} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="heading-panel truncate">{meta.label}</h3>
                <span className="pill pill-success"><CheckCircle2 size={13} /> Ready</span>
              </div>
              <p className="mt-1 text-xs text-muted-fg">Browser session · saved {formatRelative(info.updatedAt, nowMs)}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {browseHref ? (
              <Link href={browseHref} className="btn btn-primary">
                <ListMusic size={16} /> Browse playlists
              </Link>
            ) : null}
            <button type="button" onClick={() => setShowEditor(true)} className="btn btn-ghost">
              <UploadCloud size={16} /> Replace session
            </button>
          </div>
        </div>
        {notice ? <p role="status" aria-live="polite" className="mt-3 text-xs text-success-fg">{notice}</p> : null}
        {error ? <p role="alert" className="mt-3 text-xs text-danger-fg">{error}</p> : null}
      </section>
    );
  }

  return (
    <section
      id={cardId}
      className={`panel ${meta.tint} ${meta.border} relative scroll-mt-24 overflow-hidden p-5 md:scroll-mt-8 sm:p-6 ${
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
      <div className="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <div className="min-w-0">
          <header className="flex items-start justify-between gap-4 lg:block">
            <div className="flex min-w-0 items-center gap-3">
              <ServiceIcon service={info.service} size="lg" />
              <div className="min-w-0">
                <h3 className="heading-card truncate">{meta.label}</h3>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-dim-fg">
                  <UploadCloud size={16} />
                  Browser session
                </p>
              </div>
            </div>
            <span className={`pill shrink-0 lg:mt-4 ${badge.classes}`}>
              {info.isUsable ? <CheckCircle2 size={13} /> : null}
              {badge.label}
            </span>
          </header>

          <p className="mt-5 text-sm leading-6 text-muted-fg">
            {info.isUsable
              ? "Authentication cookies are present. Replace this session only if the service signs out."
              : "Upload a fresh browser export from the logged-in account."}
          </p>

          <dl className="mt-5 border-y border-[var(--border-soft)] py-4 text-sm">
            <dt className="text-xs text-dim-fg">Last saved</dt>
            <dd className="mt-1 truncate text-[var(--text)]">{formatRelative(info.updatedAt, nowMs)}</dd>
          </dl>
        </div>

        <div className="flex min-w-0 flex-col border-t border-line-soft pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          {notice ? (
            <p role="status" aria-live="polite" className="mb-3 inline-flex items-start gap-1.5 text-xs text-success-fg">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
              <span>{notice}</span>
            </p>
          ) : null}
          {error ? <p role="alert" className="mb-3 text-xs text-danger-fg">{error}</p> : null}

          {info.isUsable && browseHref ? (
            <Link href={browseHref} className="btn btn-primary w-full">
              <ListMusic size={16} />
              Browse {meta.shortLabel} playlists
            </Link>
          ) : null}

          {!showEditor ? (
            <button type="button" onClick={() => setShowEditor(true)} className="btn btn-ghost mt-2 w-full">
              <UploadCloud size={16} /> Replace saved session
            </button>
          ) : (
            <div className={info.isUsable ? "mt-4 border-t border-line-soft pt-4" : undefined}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="heading-row">{info.exists ? "Replace session" : "Upload session"}</div>
                {info.isUsable ? (
                  <button type="button" onClick={() => setShowEditor(false)} className="text-xs text-muted-fg hover:text-[var(--text)]">
                    Hide
                  </button>
                ) : null}
              </div>
              <label
                className={`surface-lift group relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-[var(--radius)] border-2 border-dashed border-[var(--border)] bg-[var(--surface-2)] p-5 text-center text-sm text-muted-fg hover:border-[var(--accent)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] ${
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
                  <CheckCircle2 size={22} className="text-success-fg transition duration-200 group-hover:-translate-y-0.5" />
                ) : (
                  <UploadCloud size={22} className="transition duration-300 group-hover:-translate-y-0.5 group-hover:scale-110" />
                )}
                <span className="font-medium">{busy ? "Uploading…" : dragOver ? "Drop to upload" : "Drop JSON or click to choose"}</span>
                <span className="inline-flex max-w-full items-center gap-1.5 truncate text-xs text-dim-fg">
                  <FileJson size={13} className="shrink-0" />
                  Playwright storageState or cookie export
                </span>
              </label>

              <details className="mt-3 text-xs text-muted-fg">
                <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-[var(--radius-sm)] px-1 py-1 transition duration-200 hover:translate-x-0.5 hover:text-[var(--text)]">
                  <Clipboard size={13} />
                  Paste JSON instead
                </summary>
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  name="sessionJson"
                  aria-label={`Pasted ${meta.label} session JSON`}
                  autoComplete="off"
                  placeholder='{ "cookies": […], "origins": […] }'
                  spellCheck={false}
                  rows={4}
                  disabled={busy}
                  className="mt-2 w-full font-mono text-xs"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" onClick={submitPasted} disabled={busy || pasted.trim().length === 0} className="btn btn-primary text-xs">
                    {busy ? "Uploading…" : "Upload pasted JSON"}
                  </button>
                  {pasted ? <button type="button" onClick={() => setPasted("")} disabled={busy} className="text-xs text-muted-fg hover:text-[var(--text)] disabled:opacity-50">Clear</button> : null}
                </div>
              </details>

              <div className="mt-4 grid gap-2">
                {info.exists ? (
                  deleteConfirm ? (
                    <div className="rounded-[var(--radius-sm)] border border-danger/20 bg-danger/10 p-2">
                      <div className="text-xs font-medium text-danger-fg">Delete saved {meta.shortLabel} session?</div>
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={clear} disabled={busy} className="btn btn-danger text-xs"><Trash2 size={13} />{busy ? "Deleting…" : "Delete"}</button>
                        <button type="button" onClick={() => setDeleteConfirm(false)} disabled={busy} className="btn btn-ghost text-xs">Keep</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setDeleteConfirm(true)} disabled={busy} className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] py-1.5 text-xs text-muted-fg transition hover:bg-danger/10 hover:text-danger-fg disabled:opacity-50">
                      <Trash2 size={13} /> Delete saved session
                    </button>
                  )
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
