import { AppShell } from "@/components/AppShell";
import { ServicePill } from "@/components/ServiceBrand";
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
      <section className="panel mb-5 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <ServicePill service="SPOTIFY" />
              <ServicePill service="YOUTUBE" />
              <ServicePill service="SOUNDCLOUD" />
            </div>
            <p className="mt-3 text-sm text-muted-fg">Latest sync activity, warnings, and failed operations.</p>
          </div>
          <div className="flex flex-wrap gap-2">
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
        </div>
      </section>
      <SyncLogTable logs={logs} />
      <div className="mt-3 text-xs text-dim-fg">Showing the latest 25 changes</div>
    </AppShell>
  );
}
