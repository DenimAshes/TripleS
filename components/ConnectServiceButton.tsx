import { Link2 } from "lucide-react";

export function ConnectServiceButton({ service }: { service: "spotify" }) {
  return (
    <form method="post" action={`/api/oauth/${service}/start`}>
      <button
        type="submit"
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border-accent)] bg-gradient-to-r from-[var(--accent-soft)] to-transparent px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition duration-200 hover:border-[var(--accent)] hover:shadow-[0_0_12px_rgba(79,141,255,0.2)]"
      >
        <Link2 size={14} /> Connect
      </button>
    </form>
  );
}
