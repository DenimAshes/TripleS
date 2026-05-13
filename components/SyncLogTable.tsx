import type { SyncLog } from "@prisma/client";
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
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[#deded8] text-left text-[#666a73]">
            <th className="p-3 font-medium">Date</th>
            <th className="p-3 font-medium">Service</th>
            <th className="p-3 font-medium">Track</th>
            <th className="p-3 font-medium">Result</th>
            <th className="p-3 font-medium">State</th>
            <th className="p-3 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b border-[#eeeeea] last:border-0">
              <td className="p-3 font-mono text-xs">{log.createdAt.toLocaleString()}</td>
              <td className="p-3">{log.service}</td>
              <td className="p-3">{log.trackTitle}</td>
              <td className="p-3">{actionLabel(log.action)}</td>
              <td className="p-3"><StatusBadge status={log.level.toLowerCase()} /></td>
              <td className="p-3 text-[#666a73]">{messageLabel(log.message)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
