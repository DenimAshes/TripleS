import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type CalloutTone = "info" | "success" | "warning" | "danger";

// One inline message box for the whole app. It replaced nineteen hand-rolled
// variants that each picked their own border/background/text combination for
// the same four meanings, which is why a warning looked different on every
// page. Tone maps to the status tokens in globals.css.
const TONES: Record<CalloutTone, { box: string; icon: ReactNode }> = {
  info: {
    box: "border-line-soft bg-surface-2 text-muted-fg",
    icon: <Info size={16} className="mt-0.5 shrink-0 text-accent" />,
  },
  success: {
    box: "border-success/25 bg-success-soft text-success-fg",
    icon: <CheckCircle2 size={16} className="mt-0.5 shrink-0" />,
  },
  warning: {
    box: "border-warning/25 bg-warning-soft text-warning-fg",
    icon: <AlertTriangle size={16} className="mt-0.5 shrink-0" />,
  },
  danger: {
    box: "border-danger/25 bg-danger-soft text-danger-fg",
    icon: <XCircle size={16} className="mt-0.5 shrink-0" />,
  },
};

export function Callout({
  tone = "info",
  title,
  children,
  action,
  icon,
  className,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Pass `false` for a text-only note. */
  icon?: ReactNode | false;
  className?: string;
}) {
  const tokens = TONES[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2.5 text-sm",
        tokens.box,
        className,
      )}
    >
      {icon === false ? null : (icon ?? tokens.icon)}
      <div className="min-w-0 flex-1">
        {title ? <div className="font-semibold text-[var(--text)]">{title}</div> : null}
        {children ? <div className={cn("min-w-0", title && "mt-1")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
