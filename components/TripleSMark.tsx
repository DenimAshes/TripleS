import { cn } from "@/lib/utils/cn";

const sizes = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
};

export function TripleSMark({
  size = "md",
  className,
}: {
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span className={cn("brand-mark", sizes[size], className)} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M8 6v20M16 6v20M24 6v20" stroke="currentColor" strokeWidth="1.5" opacity="0.42" />
        <rect x="5" y="9" width="6" height="4" rx="2" fill="var(--brand-spotify)" />
        <rect x="13" y="17" width="6" height="4" rx="2" fill="var(--brand-youtube)" />
        <rect x="21" y="12" width="6" height="4" rx="2" fill="var(--brand-soundcloud)" />
      </svg>
    </span>
  );
}
