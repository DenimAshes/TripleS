"use client";

import { Music } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pollBrowserJob, startBrowserJob } from "./browserJobClient";
import { ArtworkImage } from "./ArtworkImage";

const RETRY_AFTER_MS = 5 * 60 * 1000;

export function PlaylistTracksAutoRefresh({
  playlistId,
  hasTracks,
  activeTracks,
  expectedTracks,
}: {
  playlistId: string;
  hasTracks: boolean;
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
  const refreshInputsRef = useRef({ expectedTracks, hasTracks, initialActive });
  const needsRefresh = expectedTracks > 0 && active < expectedTracks;
  const percent = expectedTracks > 0 ? Math.min(100, Math.round((active / expectedTracks) * 100)) : 0;

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    refreshInputsRef.current = { expectedTracks, hasTracks, initialActive };
  }, [expectedTracks, hasTracks, initialActive]);

  useEffect(() => {
    const inputs = refreshInputsRef.current;
    const shouldAutoRefresh = inputs.expectedTracks > 0 && (!inputs.hasTracks || inputs.initialActive < inputs.expectedTracks);
    if (!shouldAutoRefresh) return;

    const key = `playlist-tracks-refresh:${playlistId}`;
    const lastAttempt = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - lastAttempt < RETRY_AFTER_MS) return;

    let cancelled = false;
    let interval: number | null = null;
    let startTimer: number | null = null;
    const pollController = new AbortController();

    async function readSnapshot() {
      const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, { cache: "no-store", signal: pollController.signal });
      if (!response.ok) return;
      const payload = (await response.json()) as { tracks: ApiTrack[] };
      if (cancelled) return;
      const nextActive = payload.tracks.length;
      const changed = activeRef.current !== nextActive;
      activeRef.current = nextActive;
      setActiveState({ source: inputs.initialActive, value: nextActive });
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
          if (!cancelled) setJobStep(next.currentStep);
          void readSnapshot().catch(() => {});
        }, pollController.signal);
        await readSnapshot();
        if (finished.status === "failed") {
          setError(finished.error || "Could not refresh playlist tracks.");
          return;
        }
        setJobStep(null);
      } catch (err) {
        if (pollController.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not refresh playlist tracks.");
      } finally {
        if (interval) window.clearInterval(interval);
        if (!cancelled) {
          setRunning(false);
          router.refresh();
        }
      }
    }

    // Deferring one tick keeps React Strict Mode's setup/cleanup replay from
    // starting a job and then abandoning its UI state in development.
    startTimer = window.setTimeout(() => {
      if (cancelled) return;
      sessionStorage.setItem(key, String(Date.now()));
      void run();
    }, 0);
    return () => {
      cancelled = true;
      pollController.abort();
      if (startTimer !== null) window.clearTimeout(startTimer);
      if (interval) window.clearInterval(interval);
    };
  }, [playlistId, router]);

  if (!running && !needsRefresh && !error) return null;

  return (
    <section className="mb-7 border-b border-[var(--border-soft)] pb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={`pill ${error ? "pill-danger" : running ? "pill-accent" : "pill-warning"}`}>
            {error ? "Cache failed" : running ? "Caching tracks" : "Cache incomplete"}
          </div>
          <div className="mt-2 text-sm font-medium text-[var(--text)]">
            {running ? jobStep || "Preparing playlist tracks" : "Playlist cache needs refresh"}
          </div>
          {error ? <div role="alert" className="mt-2 text-sm text-danger-fg">{error}</div> : null}
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums text-[var(--accent)]">{active}</div>
          <div className="text-xs text-dim-fg tabular-nums">
            /{expectedTracks || "?"} {expectedTracks === 1 ? "track" : "tracks"}
          </div>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className="dist-bar-fill h-full bg-gradient-to-r from-[var(--accent)] to-success transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {recent.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {recent.map((item) => (
            <div key={`${item.position}-${item.track.title}`} className="panel-inset flex min-w-0 items-center gap-2 p-2">
              <ArtworkImage
                src={item.track.imageUrl}
                width={36}
                height={36}
                className="h-9 w-9 rounded-[var(--radius-sm)] bg-[var(--surface-3)] text-dim-fg"
                fallback={<Music size={13} />}
              />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-[var(--text)]">{item.track.title}</div>
                <div className="truncate text-xs text-dim-fg">{item.track.artists.join(", ")}</div>
              </div>
            </div>
          ))}
        </div>
      ) : running ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="panel-inset h-13 animate-pulse" />
          ))}
        </div>
      ) : null}
    </section>
  );
}
