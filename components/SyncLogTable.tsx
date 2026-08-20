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

// Four columns, not six. "Result" and "State" used to be separate — one printed
// the action, the other a pill for the log level — and "Note" then said it a
// third time in a sentence. The pill now carries the action and takes its colour
// from the level, which is the pairing a reader was assembling by eye anyway.
export function SyncLogTable({ logs }: { logs: SyncLog[] }) {
  if (!logs.length) {
    return <p className="py-6 text-sm text-muted-fg">No activity yet.</p>;
  }
  return (
    // overflow-x-auto, not overflow-hidden: the table has a floor width, and
    // hiding the overflow clipped the last column off instead of scrolling it.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead className="border-b border-[var(--border-soft)] text-left text-xs font-semibold text-muted-fg">
          <tr>
            <th className="px-4 py-3.5 font-semibold">Date</th>
            <th className="px-4 py-3.5 font-semibold">Service</th>
            <th className="px-4 py-3.5 font-semibold">Track</th>
            <th className="px-4 py-3.5 font-semibold">Result</th>
            <th className="px-4 py-3.5 font-semibold">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-soft)]">
          {logs.map((log) => (
            <tr key={log.id} className="transition-colors hover:bg-[var(--surface-2)]/40">
              <td className="px-4 py-3.5 font-mono text-xs whitespace-nowrap text-muted-fg">
                {log.createdAt.toLocaleString()}
              </td>
              <td className="px-4 py-3.5 font-medium text-[var(--text)]">
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <ServiceIcon service={log.service} size="sm" className="h-6 w-6 rounded-[var(--radius-sm)]" />
                  {serviceMeta(log.service).shortLabel}
                </span>
              </td>
              <td className="px-4 py-3.5 text-[var(--text)]">{log.trackTitle}</td>
              <td className="px-4 py-3.5">
                <StatusBadge status={log.level.toLowerCase()} label={actionLabel(log.action)} />
              </td>
              <td className="max-w-xs truncate px-4 py-3.5 text-muted-fg">{messageLabel(log.message)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
