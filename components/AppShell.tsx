import { AppSidebar } from "./AppSidebar";
import { BottomNav } from "./BottomNav";

export function AppShell({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="min-h-screen md:flex">
      <AppSidebar />
      <main className="w-full pb-20 md:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
          <header className="mb-8 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-dim-fg">TripleS</div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
            </div>
            <form action="/api/auth/logout" method="post">
              <button className="btn btn-ghost">Logout</button>
            </form>
          </header>
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
