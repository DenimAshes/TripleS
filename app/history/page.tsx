import { AppShell } from "@/components/AppShell";
import { SyncLogTable } from "@/components/SyncLogTable";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const session = await getSession();
  const params = await searchParams;
  const level = params.level;
  const logs = await prisma.syncLog.findMany({
    where: { syncJob: { syncRule: { userId: session!.userId } }, ...(level ? { level } : {}) },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const activeLevel = level || "ALL";
  return (
    <AppShell title="History">
      <div className="mb-5 flex flex-wrap gap-2">
        {[
          ["ALL", "All"],
          ["INFO", "Done"],
          ["WARNING", "Needs attention"],
          ["ERROR", "Failed"],
        ].map(([value, label]) => {
          const active = activeLevel === value;
          return (
            <a
              key={value}
              href={value === "ALL" ? "/history" : `/history?level=${value}`}
              className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)] text-[var(--text)]"
                  : "border-[var(--border-soft)] bg-[var(--surface)] text-muted-fg hover:border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              }`}
            >
              {label}
            </a>
          );
        })}
      </div>
      <SyncLogTable logs={logs} />
      <div className="mt-3 text-xs text-dim-fg">Showing the latest 25 changes</div>
    </AppShell>
  );
}
