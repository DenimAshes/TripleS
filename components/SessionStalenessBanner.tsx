import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export type SessionStaleness = {
  service: string;
  severity: "stale" | "warn" | "missing";
  daysOld: number | null;
};

const SEVERITY_RANK = { stale: 3, missing: 2, warn: 1 } as const;

export function classifySession(item: { service: string; exists: boolean; updatedAt: Date | null }, now: number): SessionStaleness | null {
  if (!item.exists || !item.updatedAt) {
    return { service: item.service, severity: "missing", daysOld: null };
  }
  const days = Math.floor((now - item.updatedAt.getTime()) / 86_400_000);
  if (days >= 14) return { service: item.service, severity: "stale", daysOld: days };
  if (days >= 7) return { service: item.service, severity: "warn", daysOld: days };
  return null;
}

export function SessionStalenessBanner({ items }: { items: SessionStaleness[] }) {
  if (items.length === 0) return null;

  const ranked = [...items].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const worst = ranked[0].severity;
  // Tone via the panel pills, not full bg-color — keeps the banner consistent
  // with the rest of the dark theme.
  const accentColor =
    worst === "stale" ? "text-[#fca5a5]" : worst === "missing" ? "text-muted-fg" : "text-[#fcd34d]";

  return (
    <div className="mb-6 flex items-start gap-3 panel p-4 text-sm">
      <AlertTriangle size={18} className={`mt-0.5 shrink-0 ${accentColor}`} />
      <div className="flex-1">
        <div className={`font-medium ${accentColor}`}>Worker sessions need attention</div>
        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-fg">
          {ranked.map(({ service, severity, daysOld }) => (
            <li key={service} className="capitalize">
              <span className="text-[var(--text)]">{service}</span>:{" "}
              {severity === "missing"
                ? "no saved session"
                : severity === "stale"
                  ? `${daysOld}d old — refresh now`
                  : `${daysOld}d old`}
            </li>
          ))}
        </ul>
        <Link href="/admin/sessions" className="mt-2 inline-block text-xs font-medium text-[var(--accent)] hover:underline">
          Refresh sessions →
        </Link>
      </div>
    </div>
  );
}
