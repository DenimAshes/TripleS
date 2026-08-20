import { AlertTriangle, CheckCircle2, ListFilter, Radio, XCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
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
  const shownTotal = activeLevel === "ALL" ? totalCount : (countByLevel.get(activeLevel) ?? 0);
  const filters: Array<{ value: string; label: string; count: number; icon: React.ReactNode; tone: string }> = [
    { value: "ALL", label: "All", count: totalCount, icon: <Radio size={13} />, tone: "" },
    { value: "INFO", label: "Done", count: infoCount, icon: <CheckCircle2 size={13} />, tone: "text-success-fg" },
    { value: "WARNING", label: "Needs attention", count: warningCount, icon: <AlertTriangle size={13} />, tone: "text-warning-fg" },
    { value: "ERROR", label: "Failed", count: errorCount, icon: <XCircle size={13} />, tone: "text-danger-fg" },
  ];

  return (
    <AppShell
      title="History"
      description="Latest activity, warnings and failed operations across every rule."
    >
      {/* The three service pills here filtered nothing and the heading repeated
          the page title; what the screen needs is the counts and the filter.
          The counts then got printed twice — once as pills, once on the tabs
          beside them — so only the tabs keep them. */}
      <section className="mb-6 border-y border-[var(--border-soft)] py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 pr-1 pl-1.5 text-xs text-muted-fg">
            <ListFilter size={12} />
            Filter
          </div>
          {filters.map((filter) => {
            const active = activeLevel === filter.value;
            return (
              <a
                key={filter.value}
                href={filter.value === "ALL" ? "/history" : `/history?level=${filter.value}`}
                className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1 text-sm transition-colors ${
                  active
                    ? "border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)] text-[var(--text)]"
                    : "border-[var(--border-soft)] bg-[var(--surface)] text-muted-fg hover:border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className={active ? "text-[var(--accent)]" : filter.tone}>{filter.icon}</span>
                {filter.label}
                <span className="rounded-[var(--radius-sm)] bg-[var(--surface-3)] px-1.5 py-0.5 text-xs tabular-nums">{filter.count}</span>
              </a>
            );
          })}
        </div>
      </section>
      <SyncLogTable logs={logs} />
      <div className="mt-3 text-xs text-dim-fg">
        {logs.length
          ? `Showing the latest ${logs.length} of ${shownTotal.toLocaleString()} ${activeLevel === "ALL" ? "changes" : "matching changes"}`
          : "Nothing to show for this filter"}
      </div>
    </AppShell>
  );
}
