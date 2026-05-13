import { cn } from "@/lib/utils/cn";

const styles: Record<string, string> = {
  connected: "bg-emerald-100 text-emerald-800 border-emerald-200",
  limited: "bg-orange-100 text-orange-800 border-orange-200",
  synced: "bg-emerald-100 text-emerald-800 border-emerald-200",
  mock: "bg-sky-100 text-sky-800 border-sky-200",
  not_found: "bg-yellow-100 text-yellow-800 border-yellow-200",
  not_connected: "bg-yellow-100 text-yellow-800 border-yellow-200",
  manual_required: "bg-orange-100 text-orange-800 border-orange-200",
  error: "bg-red-100 text-red-800 border-red-200",
  failed: "bg-red-100 text-red-800 border-red-200",
  running: "bg-blue-100 text-blue-800 border-blue-200 animate-pulse",
  success: "bg-emerald-100 text-emerald-800 border-emerald-200",
  partial_success: "bg-orange-100 text-orange-800 border-orange-200",
  info: "bg-slate-100 text-slate-700 border-slate-200",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
};

export function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium", styles[key] || styles.info)}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
