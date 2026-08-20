import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";

// The editable card for one service connection. /connections and
// /admin/sessions both show it; the second page used to inline its own copy,
// which is how it ended up as the one Spotify card in the app with no status
// pill on it.
export function ServiceConnectionCard({
  id,
  service,
  status,
  mode,
  icon,
  children,
}: {
  id?: string;
  service: string;
  status: string;
  mode: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const meta = serviceMeta(service);
  const connected = status === "Connected";

  return (
    <section
      id={id}
      className={`panel ${meta.tint} ${meta.border} relative flex min-h-[360px] scroll-mt-24 flex-col overflow-hidden p-5 md:scroll-mt-8 xl:min-h-[420px]`}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <ServiceIcon service={service} size="lg" />
          <div className="min-w-0">
            <h3 className="heading-card truncate">{meta.label}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-dim-fg">
              {icon}
              {mode}
            </p>
          </div>
        </div>
        <span className={`pill shrink-0 ${connected ? "pill-success" : "pill-warning"}`}>
          {connected ? <CheckCircle2 size={13} /> : null}
          {status}
        </span>
      </header>
      <div className="mt-5 flex flex-1 flex-col">{children}</div>
    </section>
  );
}
