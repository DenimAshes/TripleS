import { AppSidebar } from "./AppSidebar";
import { BottomNav } from "./BottomNav";
import { HealthIndicator } from "./HealthIndicator";

export function AppShell({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="min-h-screen md:flex">
      <AppSidebar />
      <main className="relative w-full pb-20 md:pb-0 bg-[#050608] overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
          <header className="relative z-10 mb-10 flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] font-bold text-blue-500/70">TripleS workspace</div>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-white md:text-4xl">{title}</h1>
            </div>
            <div className="flex items-center gap-4">
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
