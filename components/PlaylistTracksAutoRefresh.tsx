"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pollBrowserJob, startBrowserJob } from "./browserJobClient";

const RETRY_AFTER_MS = 5 * 60 * 1000;

export function PlaylistTracksAutoRefresh({
  playlistId,
  hasTracks,
  activeTracks,
  expectedTracks,
}: {
  playlistId: string;
  hasTracks: boolean;
  lastFetchedAt: string | null;
  activeTracks: number;
  expectedTracks: number;
}) {
  return (
    <PlaylistTracksLiveProgress
      playlistId={playlistId}
      initialActive={activeTracks}
      expectedTracks={expectedTracks}
      hasTracks={hasTracks}
    />
  );
}

type ApiTrack = {
  position: number;
  track: {
    title: string;
    artists: string[];
    imageUrl: string | null;
  };
};

function PlaylistTracksLiveProgress({
  playlistId,
  initialActive,
  expectedTracks,
  hasTracks,
}: {
  playlistId: string;
  initialActive: number;
  expectedTracks: number;
  hasTracks: boolean;
}) {
  const router = useRouter();
  const [activeState, setActiveState] = useState({ source: initialActive, value: initialActive });
  const [jobStep, setJobStep] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [recent, setRecent] = useState<ApiTrack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const active = activeState.source === initialActive ? activeState.value : initialActive;
  const activeRef = useRef(active);
  const needsRefresh = expectedTracks > 0 && active < expectedTracks;
  const percent = expectedTracks > 0 ? Math.min(100, Math.round((active / expectedTracks) * 100)) : 0;

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const shouldAutoRefresh = expectedTracks > 0 && (!hasTracks || needsRefresh);
    if (!shouldAutoRefresh) return;

    const key = `playlist-tracks-refresh:${playlistId}`;
    const lastAttempt = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - lastAttempt < RETRY_AFTER_MS) return;
    sessionStorage.setItem(key, String(Date.now()));

    let cancelled = false;
    let interval: number | null = null;

    async function readSnapshot() {
      const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { tracks: ApiTrack[] };
      if (cancelled) return;
      const nextActive = payload.tracks.length;
      const changed = activeRef.current !== nextActive;
      activeRef.current = nextActive;
      setActiveState({ source: initialActive, value: nextActive });
      setRecent(payload.tracks.slice(-5).reverse());
      if (changed) router.refresh();
    }

    async function run() {
      setRunning(true);
      setError(null);
      try {
        const job = await startBrowserJob("playlistTracks.refresh", { playlistId });
        setJobStep(job.currentStep);
        interval = window.setInterval(() => {
          void readSnapshot().catch(() => {});
        }, 1200);
        const finished = await pollBrowserJob(job.id, (next) => {
          setJobStep(next.currentStep);
          void readSnapshot().catch(() => {});
        });
        await readSnapshot();
        if (finished.status === "failed") {
          setError(finished.error || "Could not refresh playlist tracks.");
          return;
        }
        setJobStep(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not refresh playlist tracks.");
      } finally {
        if (interval) window.clearInterval(interval);
        if (!cancelled) {
          setRunning(false);
          router.refresh();
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [expectedTracks, hasTracks, initialActive, needsRefresh, playlistId, router]);

  if (!running && !needsRefresh && !error) return null;

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-blue-500/20 bg-[#0d0e12]/80 p-5 shadow-[0_0_40px_rgba(59,130,246,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-400">Live cache stream</div>
          <div className="mt-2 text-sm font-semibold text-white">
            {running ? jobStep || "Preparing playlist tracks" : "Playlist cache needs refresh"}
          </div>
          {error ? <div className="mt-2 text-sm text-[#fca5a5]">{error}</div> : null}
        </div>
        <div className="text-right font-mono">
          <div className="text-2xl font-black text-blue-300">{active}</div>
          <div className="text-xs text-slate-500">/{expectedTracks || "?"} tracks</div>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full border border-white/5 bg-black/50">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-600 via-cyan-300 to-emerald-300 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {recent.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {recent.map((item) => (
            <div key={`${item.position}-${item.track.title}`} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/5 bg-black/20 p-2">
              {item.track.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.track.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="h-9 w-9 shrink-0 rounded-lg bg-[var(--surface-2)]" />
              )}
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-white">{item.track.title}</div>
                <div className="truncate text-[11px] text-slate-500">{item.track.artists.join(", ")}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-13 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
          ))}
        </div>
      )}
    </section>
  );
}
