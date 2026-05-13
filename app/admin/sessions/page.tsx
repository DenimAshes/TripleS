import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SessionUploader } from "@/components/SessionUploader";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

const SERVICES = ["youtube", "spotify", "soundcloud"] as const;

export default async function AdminSessionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await prisma.workerSessionState.findMany({
    where: { service: { in: SERVICES as unknown as string[] } },
  });
  const byService = new Map(rows.map((r) => [r.service, r]));

  const sessions = SERVICES.map((service) => {
    const row = byService.get(service);
    return {
      service,
      exists: !!row,
      bytes: row?.bytes ?? 0,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });

  return (
    <AppShell title="Worker sessions">
      <div className="space-y-6">
        <section className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
          <h2 className="mb-2 font-medium text-neutral-900 dark:text-neutral-100">How to refresh a session</h2>
          <ol className="ml-5 list-decimal space-y-1">
            <li>In your personal browser (Chrome, Firefox), log in to the service (e.g. <code>music.youtube.com</code>).</li>
            <li>Install the free <a className="underline" href="https://cookie-editor.com/" target="_blank" rel="noreferrer">Cookie-Editor</a> extension (open source, MIT).</li>
            <li>Open the extension on the logged-in tab → <strong>Export</strong> → <strong>Export as Playwright</strong> if available, otherwise <strong>Export as JSON</strong> (bare cookie array also works).</li>
            <li>Drop the downloaded JSON file into the matching service below, or expand <em>Or paste JSON</em> and Ctrl+V the contents.</li>
            <li>The next scheduled sync run will use the refreshed session.</li>
          </ol>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            The state is stored gzipped in the database and read by the GitHub Actions sync worker on every run. Nothing is written to disk on Vercel.
          </p>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((s) => (
            <SessionUploader key={s.service} initial={s} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
