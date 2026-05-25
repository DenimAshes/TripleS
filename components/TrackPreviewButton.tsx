"use client";

import { ExternalLink, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function youtubeId(trackId: string, url?: string | null): string | null {
  if (/^[a-zA-Z0-9_-]{8,}$/.test(trackId) && !trackId.includes("/")) return trackId;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).at(-1) || null;
  } catch {
    return null;
  }
}

function embedUrl(service: string, trackId: string, url?: string | null): string | null {
  const key = service.toUpperCase();
  if (key === "YOUTUBE") {
    const id = youtubeId(trackId, url);
    return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&start=30` : null;
  }
  if (key === "SOUNDCLOUD") {
    const trackUrl = url || `https://soundcloud.com/${trackId}`;
    return `https://w.soundcloud.com/player/?url=${encodeURIComponent(trackUrl)}&auto_play=true&visual=false`;
  }
  if (key === "SPOTIFY") {
    const id = trackId.includes(":") ? trackId.split(":").at(-1) : trackId;
    return id ? `https://open.spotify.com/embed/track/${encodeURIComponent(id)}?utm_source=generator` : null;
  }
  return null;
}

export function TrackPreviewButton({
  service,
  serviceTrackId,
  url,
}: {
  service: string;
  serviceTrackId: string;
  url?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const src = useMemo(() => embedUrl(service, serviceTrackId, url), [service, serviceTrackId, url]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOpen(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!src && !url) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (src ? setOpen((value) => !value) : window.open(url || "", "_blank", "noopener,noreferrer"))}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-2.5 text-xs font-semibold text-muted-fg transition hover:border-[var(--border)] hover:text-[var(--text)]"
        title={src ? "Play a short preview" : "Open track"}
      >
        {src ? open ? <Pause size={13} /> : <Play size={13} /> : <ExternalLink size={13} />}
        {src ? (open ? "Stop" : "Preview") : "Open"}
      </button>
      {open && src ? (
        <div className="absolute bottom-10 right-0 z-30 w-72 overflow-hidden rounded-xl border border-[var(--border-soft)] bg-black shadow-[0_22px_80px_-24px_rgba(0,0,0,0.95)]">
          <iframe
            title="Track preview"
            src={src}
            className="h-24 w-full border-0"
            allow="autoplay; encrypted-media"
            loading="lazy"
          />
        </div>
      ) : null}
    </div>
  );
}
