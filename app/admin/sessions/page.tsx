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
        <section className="panel p-5 text-sm text-muted-fg">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim-fg">
            How to refresh a session
          </h2>
          <ol className="ml-5 list-decimal space-y-1.5">
            <li>
              In your personal browser (Chrome, Firefox), log in to the service (e.g.{" "}
              <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs">music.youtube.com</code>).
            </li>
            <li>
              Install the free{" "}
              <a
                className="text-[var(--accent)] hover:underline"
                href="https://cookie-editor.com/"
                target="_blank"
                rel="noreferrer"
              >
                Cookie-Editor
              </a>{" "}
              extension (open source, MIT).
            </li>
            <li>
              Open the extension on the logged-in tab → <strong className="text-[var(--text)]">Export</strong> →{" "}
              <strong className="text-[var(--text)]">Export as Playwright</strong> if available, otherwise{" "}
              <strong className="text-[var(--text)]">Export as JSON</strong> (bare cookie array also works).
            </li>
            <li>
              Drop the downloaded JSON file into the matching service below, or expand <em>Or paste JSON</em> and
              Ctrl+V the contents.
            </li>
            <li>The next scheduled sync run will use the refreshed session.</li>
          </ol>
          <p className="mt-3 text-xs text-dim-fg">
            The state is stored gzipped in the database and read by the GitHub Actions sync worker on every run.
            Nothing is written to disk on Vercel.
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
