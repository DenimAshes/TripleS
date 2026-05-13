import { AppSidebar } from "./AppSidebar";
import { BottomNav } from "./BottomNav";

export function AppShell({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="min-h-screen md:flex">
      <AppSidebar />
      <main className="w-full pb-20 md:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <header className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
            <form action="/api/auth/logout" method="post">
              <button className="rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm hover:bg-[#f0f0ec]">Logout</button>
            </form>
          </header>
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
