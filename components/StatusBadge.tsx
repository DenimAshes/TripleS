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

// The pill class used to force uppercase, so raw keys like `partial_success`
// rendered acceptably. Now that casing is authored, spell the labels out.
const labels: Record<string, string> = {
  connected: "Connected",
  synced: "Synced",
  success: "Success",
  needs_login: "Needs login",
  limited: "Limited",
  not_found: "Not found",
  not_connected: "Not connected",
  manual_required: "Needs review",
  partial_success: "Partial",
  warning: "Warning",
  failed: "Failed",
  error: "Error",
  running: "Running",
  mock: "Mock data",
  info: "Info",
};

// `label` overrides the text while keeping the tone. The sync log needs it: the
// row's tone comes from the log level, but the words worth reading are the
// action ("Not found", "Added"), and printing both meant two columns saying the
// same thing in different words.
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const key = status.toLowerCase();
  const text = label ?? labels[key] ?? status.replaceAll("_", " ");
  return <span className={cn("pill", styles[key] ?? styles.info)}>{text}</span>;
}
