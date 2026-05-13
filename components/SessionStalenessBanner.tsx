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
  const tone =
    worst === "stale"
      ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
      : worst === "missing"
        ? "border-neutral-300 bg-neutral-50 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100";

  return (
    <div className={`mt-4 flex items-start gap-3 rounded-md border p-3 text-sm ${tone}`}>
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="font-medium">Worker sessions need attention</div>
        <ul className="mt-1 text-xs">
          {ranked.map(({ service, severity, daysOld }) => (
            <li key={service} className="capitalize">
              {service}:{" "}
              {severity === "missing"
                ? "no saved session"
                : severity === "stale"
                  ? `${daysOld}d old — refresh now`
                  : `${daysOld}d old`}
            </li>
          ))}
        </ul>
        <Link href="/admin/sessions" className="mt-2 inline-block text-xs font-medium underline">
          Refresh sessions →
        </Link>
      </div>
    </div>
  );
}
