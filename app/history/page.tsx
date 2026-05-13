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

  return (
    <AppShell title="History">
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["ALL", "All"],
          ["INFO", "Done"],
          ["WARNING", "Needs attention"],
          ["ERROR", "Failed"],
        ].map(([value, label]) => (
          <a key={value} href={value === "ALL" ? "/history" : `/history?level=${value}`} className="rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm">{label}</a>
        ))}
      </div>
      <SyncLogTable logs={logs} />
      <div className="mt-3 text-sm text-[#666a73]">Showing the latest 25 changes</div>
    </AppShell>
  );
}
