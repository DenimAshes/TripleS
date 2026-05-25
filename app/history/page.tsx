import { AlertTriangle, CheckCircle2, ListFilter, Radio, XCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ServicePill } from "@/components/ServiceBrand";
import { SyncLogTable } from "@/components/SyncLogTable";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const session = await getSession();
  const params = await searchParams;
  const level = params.level;
  const [logs, levelCounts] = await Promise.all([
    prisma.syncLog.findMany({
      where: { syncJob: { syncRule: { userId: session!.userId } }, ...(level ? { level } : {}) },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.syncLog.groupBy({
      by: ["level"],
      where: { syncJob: { syncRule: { userId: session!.userId } } },
      _count: { _all: true },
    }),
  ]);
  const countByLevel = new Map(levelCounts.map((row) => [row.level, row._count._all]));
  const totalCount = levelCounts.reduce((sum, row) => sum + row._count._all, 0);
  const infoCount = countByLevel.get("INFO") ?? 0;
  const warningCount = countByLevel.get("WARNING") ?? 0;
  const errorCount = countByLevel.get("ERROR") ?? 0;

  const activeLevel = level || "ALL";
  const filters: Array<{ value: string; label: string; count: number; icon: React.ReactNode; tone: string }> = [
    { value: "ALL", label: "All", count: totalCount, icon: <Radio size={13} />, tone: "" },
    { value: "INFO", label: "Done", count: infoCount, icon: <CheckCircle2 size={13} />, tone: "text-emerald-300" },
    { value: "WARNING", label: "Needs attention", count: warningCount, icon: <AlertTriangle size={13} />, tone: "text-amber-300" },
    { value: "ERROR", label: "Failed", count: errorCount, icon: <XCircle size={13} />, tone: "text-rose-300" },
  ];

  return (
    <AppShell title="History">
      <section className="panel group surface-lift animated-gradient-frame animated-sheen relative mb-5 overflow-hidden p-5 animate-slide-in-up">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-70" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <ServicePill service="SPOTIFY" />
              <ServicePill service="YOUTUBE" />
              <ServicePill service="SOUNDCLOUD" />
            </div>
            <h2 className="mt-4 text-2xl font-black tracking-tight text-white">Sync history</h2>
            <p className="mt-2 text-sm leading-6 text-muted-fg">Latest activity, warnings, and failed operations across every rule.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-dim-fg">
              <span className="pill"><CheckCircle2 size={12} />{infoCount} done</span>
              <span className={`pill ${warningCount > 0 ? "pill-warning" : ""}`}><AlertTriangle size={12} />{warningCount} warnings</span>
              <span className={`pill ${errorCount > 0 ? "pill-danger" : ""}`}><XCircle size={12} />{errorCount} failed</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-dim-fg">
              <ListFilter size={12} />
              Filter
            </div>
            {filters.map((filter) => {
              const active = activeLevel === filter.value;
              return (
                <a
                  key={filter.value}
                  href={filter.value === "ALL" ? "/history" : `/history?level=${filter.value}`}
                  className={`surface-lift inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? "border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)] text-[var(--text)] shadow-[0_14px_30px_-28px_var(--accent-glow)]"
                      : "border-[var(--border-soft)] bg-[var(--surface)] text-muted-fg hover:border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className={active ? "text-[var(--accent)]" : filter.tone}>{filter.icon}</span>
                  {filter.label}
                  <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-xs tabular-nums">{filter.count}</span>
                </a>
              );
            })}
          </div>
        </div>
      </section>
      <SyncLogTable logs={logs} />
      <div className="mt-3 text-xs text-dim-fg">Showing the latest 25 changes</div>
    </AppShell>
  );
}
