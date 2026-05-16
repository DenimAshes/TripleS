import { cn } from "@/lib/utils/cn";

// Map every status the app produces to one of the pill variants defined
// in globals.css. Anything unknown falls back to the neutral pill.
const styles: Record<string, string> = {
  connected: "pill-success",
  synced: "pill-success",
  success: "pill-success",
  needs_login: "pill-warning",
  limited: "pill-warning",
  not_found: "pill-warning",
  not_connected: "pill-warning",
  manual_required: "pill-warning",
  partial_success: "pill-warning",
  warning: "pill-warning",
  failed: "pill-danger",
  error: "pill-danger",
  running: "pill-accent animate-pulse",
  mock: "pill-accent",
  info: "",
};

export function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  return <span className={cn("pill", styles[key] ?? styles.info)}>{status.replaceAll("_", " ")}</span>;
}
