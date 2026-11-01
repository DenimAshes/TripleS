import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";

// The editable card for one service connection on /connections.
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
      className={`panel ${meta.tint} ${meta.border} relative scroll-mt-24 overflow-hidden p-5 md:scroll-mt-8 sm:p-6`}
    >
      <div className="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <header className="flex items-start justify-between gap-4 lg:block">
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
          <span className={`pill shrink-0 lg:mt-4 lg:inline-flex ${connected ? "pill-success" : "pill-warning"}`}>
            {connected ? <CheckCircle2 size={13} /> : null}
            {status}
          </span>
        </header>
        <div className="flex min-w-0 flex-col border-t border-line-soft pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">{children}</div>
      </div>
    </section>
  );
}
