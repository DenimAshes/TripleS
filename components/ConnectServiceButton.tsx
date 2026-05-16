import { Link2 } from "lucide-react";

export function ConnectServiceButton({ service }: { service: "spotify" }) {
  return (
    <form method="post" action={`/api/oauth/${service}/start`}>
      <button
        type="submit"
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition hover:border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] hover:bg-[var(--surface-hover)]"
      >
        <Link2 size={13} /> Connect
      </button>
    </form>
  );
}
