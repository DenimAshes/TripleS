import Link from "next/link";
import { AlertTriangle } from "lucide-react";

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
  const worst = ranked[0].severity;
  const borderColor = worst === "stale" ? "border-red-500/30" : "border-amber-500/30";
  const stripeColor = worst === "stale" ? "from-red-500" : "from-amber-500";
  const accentColor =
    worst === "stale" ? "text-[#fca5a5]" : worst === "missing" ? "text-[#fbbf24]" : "text-[#fcd34d]";

  return (
    <div
      className={`relative mb-8 flex items-start gap-5 overflow-hidden rounded-2xl border ${borderColor} bg-[#0d0e12]/60 p-6 backdrop-blur-xl`}
    >
      <div className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${stripeColor} to-transparent`} />
      <AlertTriangle size={24} className={`shrink-0 ${accentColor} animate-pulse`} strokeWidth={2.5} />
      <div className="min-w-0 flex-1">
        <div className={`text-xs font-black uppercase tracking-widest ${accentColor}`}>Connection Needs Attention</div>
        <ul className="mt-3 space-y-1.5 text-xs font-medium text-slate-400">
          {ranked.map(({ service, severity, daysOld }) => (
            <li key={service} className="capitalize">
              <span className="font-bold text-white">{service}</span> {describe(severity, daysOld)}
            </li>
          ))}
        </ul>
        <Link
          href="/connections"
          className="mt-4 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 transition-colors hover:text-blue-300"
        >
          Open connections <span aria-hidden="true">-&gt;</span>
        </Link>
      </div>
    </div>
  );
}
