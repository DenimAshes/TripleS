import type { SyncLog } from "@prisma/client";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";
import { StatusBadge } from "./StatusBadge";

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    already_synced: "Already added",
    synced: "Added",
    manual_required: "Needs review",
    rejected_candidate: "Skipped",
    not_found: "Not found",
    removed: "Removed",
  };
  return labels[action] || action.replaceAll("_", " ");
}

function messageLabel(message: string) {
  return message
    .replace(/Already present.*/i, "Already in the playlist")
    .replace(/Added with.*/i, "Added to the playlist")
    .replace(/Manual review required.*/i, "Please choose the right song")
    .replace(/No reliable match found.*/i, "No matching song found")
    .replace(/Removed system-added track missing from source.*/i, "Removed from the playlist");
}

export function SyncLogTable({ logs }: { logs: SyncLog[] }) {
  if (!logs.length) {
    return <div className="panel p-8 text-center text-sm text-muted-fg">No activity yet.</div>;
  }
  return (
    <div className="panel overflow-hidden">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead className="bg-gradient-to-r from-[var(--surface-2)] to-transparent text-left text-xs uppercase tracking-widest font-semibold text-dim-fg border-b border-[var(--border-soft)]">
          <tr>
            <th className="px-4 py-3.5 font-semibold">Date</th>
            <th className="px-4 py-3.5 font-semibold">Service</th>
            <th className="px-4 py-3.5 font-semibold">Track</th>
            <th className="px-4 py-3.5 font-semibold">Result</th>
            <th className="px-4 py-3.5 font-semibold">State</th>
            <th className="px-4 py-3.5 font-semibold">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-soft)]">
          {logs.map((log) => (
            <tr
              key={log.id}
              className="transition duration-200 hover:bg-[var(--surface-2)]/40"
            >
              <td className="px-4 py-3.5 font-mono text-xs text-muted-fg whitespace-nowrap">{log.createdAt.toLocaleString()}</td>
              <td className="px-4 py-3.5 font-medium text-[var(--text)]">
                <span className="inline-flex items-center gap-2">
                  <ServiceIcon service={log.service} size="sm" className="h-6 w-6 rounded-md" />
                  {serviceMeta(log.service).shortLabel}
                </span>
              </td>
              <td className="px-4 py-3.5 text-[var(--text)]">{log.trackTitle}</td>
              <td className="px-4 py-3.5 text-muted-fg">{actionLabel(log.action)}</td>
              <td className="px-4 py-3.5">
                <StatusBadge status={log.level.toLowerCase()} />
              </td>
              <td className="px-4 py-3.5 text-muted-fg max-w-xs truncate">{messageLabel(log.message)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
