import Link from "next/link";
import { Callout } from "./Callout";

export type SessionStaleness = {
  service: string;
  severity: "stale" | "warn" | "missing";
  daysOld: number | null;
};

const SEVERITY_RANK = { stale: 3, missing: 2, warn: 1 } as const;

export function classifySession(
  item: { service: string; exists: boolean; updatedAt: Date | null },
  now: number,
): SessionStaleness | null {
  if (!item.exists || !item.updatedAt) {
    return { service: item.service, severity: "missing", daysOld: null };
  }
  const days = Math.floor((now - item.updatedAt.getTime()) / 86_400_000);
  if (days >= 14) return { service: item.service, severity: "stale", daysOld: days };
  if (days >= 7) return { service: item.service, severity: "warn", daysOld: days };
  return null;
}

function describe(severity: SessionStaleness["severity"], daysOld: number | null): string {
  if (severity === "missing") return "is not connected";
  if (severity === "stale") return `has an old session (${daysOld}d old, refresh now)`;
  return `session is ageing (${daysOld}d old)`;
}

export function SessionStalenessBanner({ items }: { items: SessionStaleness[] }) {
  if (items.length === 0) return null;

  const ranked = [...items].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return (
    <Callout
      tone={ranked[0].severity === "stale" ? "danger" : "warning"}
      title="Connections need attention"
      className="mb-6"
      action={
        <Link href="/connections" className="text-xs font-medium text-[var(--accent)] hover:underline">
          Open connections
        </Link>
      }
    >
      <ul className="space-y-1">
        {ranked.map(({ service, severity, daysOld }) => (
          <li key={service}>
            <span className="font-medium capitalize text-[var(--text)]">{service}</span> {describe(severity, daysOld)}
          </li>
        ))}
      </ul>
    </Callout>
  );
}
