import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import { BottomNav } from "./BottomNav";
import { CommandPalette } from "./CommandPalette";
import { HealthIndicator } from "./HealthIndicator";
import { TripleSMark } from "./TripleSMark";

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
  backHref,
  backLabel = "Back",
}: {
  children: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="min-h-dvh md:flex">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <AppSidebar />
      <main id="main-content" tabIndex={-1} className="relative w-full min-w-0 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="flex h-14 items-center justify-between border-b border-line-soft bg-[var(--sidebar)] px-4 md:hidden">
          <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="TripleS home">
            <TripleSMark size="sm" />
            <span translate="no" className="text-sm font-semibold tracking-[-0.02em]">TripleS</span>
          </Link>
          <HealthIndicator />
        </div>
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 md:px-8 md:py-8">
          <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line-soft pb-5 md:mb-8">
            <div className="min-w-0 flex-1">
              {backHref ? (
                <Link href={backHref} className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-fg transition-colors hover:text-[var(--text)]">
                  <ArrowLeft size={13} />
                  {backLabel}
                </Link>
              ) : null}
              <h1 className="heading-page text-balance">{title}</h1>
              {description ? (
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-fg">{description}</p>
              ) : null}
            </div>
            <div className={`${actions ? "flex" : "hidden sm:flex"} w-full flex-wrap items-center gap-2 lg:w-auto lg:shrink-0 lg:justify-end`}>
              {actions}
              <CommandPalette />
            </div>
          </header>
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
