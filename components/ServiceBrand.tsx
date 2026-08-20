import { cn } from "@/lib/utils/cn";

export type ServiceKey = "SPOTIFY" | "YOUTUBE" | "SOUNDCLOUD";

type ServiceMeta = {
  key: ServiceKey;
  label: string;
  shortLabel: string;
  /** Sets --service-glow / --service-ink for everything inside. */
  tint: string;
  /** Brand fill, for stripes and marks. */
  bg: string;
  /** Brand-tinted border, for a card that belongs to one service. */
  border: string;
  /** Pair with `pill`: a brand-tinted label. */
  pill: string;
};

// Brand colours live in globals.css as --brand-*. This file only names which
// token belongs to which service; it never spells a colour out, so a service
// looks the same in a pill, a card border and a table stripe.
const META: Record<ServiceKey, ServiceMeta> = {
  SPOTIFY: {
    key: "SPOTIFY",
    label: "Spotify",
    shortLabel: "Spotify",
    tint: "service-glow-spotify",
    bg: "bg-[var(--brand-spotify)]",
    border: "border-[color-mix(in_srgb,var(--brand-spotify)_26%,var(--border-soft))]",
    pill: "pill-spotify",
  },
  YOUTUBE: {
    key: "YOUTUBE",
    label: "YouTube Music",
    shortLabel: "YouTube",
    tint: "service-glow-youtube",
    bg: "bg-[var(--brand-youtube)]",
    border: "border-[color-mix(in_srgb,var(--brand-youtube)_26%,var(--border-soft))]",
    pill: "pill-youtube",
  },
  SOUNDCLOUD: {
    key: "SOUNDCLOUD",
    label: "SoundCloud",
    shortLabel: "SoundCloud",
    tint: "service-glow-soundcloud",
    bg: "bg-[var(--brand-soundcloud)]",
    border: "border-[color-mix(in_srgb,var(--brand-soundcloud)_26%,var(--border-soft))]",
    pill: "pill-soundcloud",
  },
};

// An unknown service falls back to the accent rather than to a colour of its
// own, so adding a fourth platform can't quietly introduce an off-palette tone.
export function serviceMeta(service: string): ServiceMeta {
  return (
    META[service.toUpperCase() as ServiceKey] ?? {
      key: service.toUpperCase() as ServiceKey,
      label: service,
      shortLabel: service,
      tint: "",
      bg: "bg-[var(--accent)]",
      border: "border-[color-mix(in_srgb,var(--accent)_26%,var(--border-soft))]",
      pill: "pill-accent",
    }
  );
}

export function ServiceIcon({
  service,
  size = "md",
  className,
}: {
  service: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const meta = serviceMeta(service);
  const sizeClass = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-14 w-14" : "h-10 w-10";
  const iconSize = size === "sm" ? 16 : size === "lg" ? 30 : 22;

  return (
    <span className={cn("service-mark", meta.tint, sizeClass, className)}>
      {meta.key === "SPOTIFY" ? <SpotifyGlyph size={iconSize} /> : null}
      {meta.key === "YOUTUBE" ? <YouTubeGlyph size={iconSize} /> : null}
      {meta.key === "SOUNDCLOUD" ? <SoundCloudGlyph size={iconSize} /> : null}
      {!["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"].includes(meta.key) ? (
        <span className="text-xs font-semibold">{meta.shortLabel.slice(0, 1)}</span>
      ) : null}
    </span>
  );
}

export function ServicePill({ service, className }: { service: string; className?: string }) {
  const meta = serviceMeta(service);
  return (
    <span className={cn("pill", meta.pill, className)}>
      <ServiceIcon service={service} size="sm" className="h-5 w-5" />
      {meta.label}
    </span>
  );
}

export function SpotifyGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.4 9.3c3.9-1.1 7.8-.7 11.5 1.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7.1 12.7c3.1-.8 6.2-.5 9.1 1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.8 15.7c2.4-.5 4.7-.3 6.9.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function YouTubeGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 8.2c0-1.4 1.1-2.6 2.5-2.8 3-.3 6-.3 9 0 1.4.2 2.5 1.4 2.5 2.8v7.6c0 1.4-1.1 2.6-2.5 2.8-3 .3-6 .3-9 0A2.8 2.8 0 0 1 5 15.8V8.2Z" fill="currentColor" opacity="0.95" />
      <path d="m10.4 9 5 3-5 3V9Z" fill="var(--brand-youtube)" />
    </svg>
  );
}

export function SoundCloudGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.2 14.2h1.2v3H4.2v-3Zm2.2-2.2h1.2v5.2H6.4V12Zm2.2-1.6h1.2v6.8H8.6v-6.8Zm2.2-1.9h1.2v8.7h-1.2V8.5Zm2.7 8.7h3.9a3.1 3.1 0 0 0 .3-6.2 4.6 4.6 0 0 0-8.1-1.9v8.1h3.9Z" fill="currentColor" />
    </svg>
  );
}
