import type { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { BottomNav } from "./BottomNav";
import { CommandPalette } from "./CommandPalette";
import { HealthIndicator } from "./HealthIndicator";

// The only page header in the app. Pages used to print the title here and then
// repeat it inside a decorated hero panel below ("History" → "Sync history"),
// which cost ~250px of vertical space per page and gave every screen a
// different rhythm. `description` and `actions` exist so a page can put its
// controls in the header instead of building another hero.
export function AppShell({
  children,
  title,
  description,
  actions,
}: {
  children: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="min-h-screen md:flex">
      <AppSidebar />
      <main className="relative w-full pb-24 md:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-7 md:px-8">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <h1 className="heading-page">{title}</h1>
              {description ? (
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-fg">{description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <CommandPalette />
              <HealthIndicator />
              <form action="/api/auth/logout" method="post">
                <button className="btn btn-ghost">Logout</button>
              </form>
            </div>
          </header>
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
