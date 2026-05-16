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
  // Color coding based on severity
  const bgGradient = worst === "stale" ? "from-[#ef4444]/10 to-transparent" : worst === "missing" ? "from-[#f59e0b]/10 to-transparent" : "from-[#f59e0b]/10 to-transparent";
  const borderColor = worst === "stale" ? "border-[#ef4444]/30" : worst === "missing" ? "border-[#f59e0b]/30" : "border-[#f59e0b]/30";
  const bgGradient = worst === "stale" ? "from-red-500/10" : "from-amber-500/10";
  const borderColor = worst === "stale" ? "border-red-500/20" : "border-amber-500/20";
  const accentColor = worst === "stale" ? "text-[#fca5a5]" : worst === "missing" ? "text-[#fbbf24]" : "text-[#fcd34d]";

  return (
    <div className={`mb-6 flex items-start gap-4 panel bg-gradient-to-r ${bgGradient} border ${borderColor} p-5`}>
      <AlertTriangle size={20} className={`mt-0.5 shrink-0 ${accentColor}`} strokeWidth={2} />
    <div className={`relative mb-8 overflow-hidden rounded-2xl border ${borderColor} bg-[#0d0e12]/60 p-6 backdrop-blur-xl flex items-start gap-5`}>
      <div className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${worst === 'stale' ? 'from-red-500' : 'from-amber-500'} to-transparent`} />
      <AlertTriangle size={24} className={`shrink-0 ${accentColor} animate-pulse`} strokeWidth={2.5} />
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-base ${accentColor}`}>Worker sessions need attention</div>
        <ul className="mt-2 space-y-1 text-sm text-muted-fg">
        <div className={`font-black uppercase tracking-widest text-xs ${accentColor}`}>System Alert: Session Degraded</div>
        <ul className="mt-3 space-y-1.5 text-xs font-medium text-slate-400">
          {ranked.map(({ service, severity, daysOld }) => (
            <li key={service} className="capitalize">
              <span className="text-[var(--text)] font-medium">{service}</span>
              <span className="text-white font-bold">{service}</span>
              {severity === "missing"
                ? " — no saved session"
                ? " — integrity lost (missing token)"
                : severity === "stale"
                  ? ` — ${daysOld}d old (refresh now)`
                  : ` — ${daysOld}d old`}
                  ? ` — stale context (${daysOld}d old)`
                  : ` — ageing context (${daysOld}d)`}
            </li>
          ))}
        </ul>
        <Link href="/admin/sessions" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)] transition">
          Refresh sessions <span>→</span>
        <Link href="/admin/sessions" className="mt-4 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 hover:text-blue-300 transition-colors">
          Re-authorize Nodes <span>→</span>
        </Link>
      </div>
    </div>
  );
}
