import { AppSidebar } from "./AppSidebar";
import { BottomNav } from "./BottomNav";

export function AppShell({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="min-h-screen md:flex">
      <AppSidebar />
      <main className="relative w-full pb-20 md:pb-0 bg-[#050608] overflow-hidden">
        {/* Global background ambient glow */}
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
          <header className="relative z-10 mb-10 flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.4em] font-bold text-blue-500/60">System Core</div>
              <h1 className="mt-2 text-4xl font-black tracking-tighter text-white bg-gradient-to-r from-white via-white to-blue-500/50 bg-clip-text text-transparent">{title}</h1>
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
