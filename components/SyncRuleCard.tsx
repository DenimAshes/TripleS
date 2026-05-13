import type { SyncDestination, SyncRule } from "@prisma/client";
import Link from "next/link";
import { Pencil, Play } from "lucide-react";
import { RunSyncButton } from "./RunSyncButton";
import { StatusBadge } from "./StatusBadge";

function modeLabel(mode: string) {
  const labels: Record<string, string> = {
    ADD_ONLY: "Add new songs",
    ADD_AND_REMOVE: "Keep playlists matched",
    FULL_MIRROR: "Mirror playlist",
  };
  return labels[mode] || mode;
}

export function SyncRuleCard({ rule }: { rule: SyncRule & { destinations: SyncDestination[] } }) {
  return (
    <div className="panel p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{rule.name}</h3>
            <StatusBadge status={rule.isEnabled ? "connected" : "not_connected"} />
          </div>
          <p className="mt-1 text-sm text-[#666a73]">
            {rule.sourceService} {"->"} {rule.destinations.map((item) => item.service).join(", ")} / {modeLabel(rule.mode)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/settings?rule=${rule.id}`} className="inline-flex items-center justify-center gap-2 rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm font-medium">
            <Pencil size={16} /> Edit
          </Link>
          <RunSyncButton ruleId={rule.id}>
            <Play size={16} /> Run now
          </RunSyncButton>
        </div>
      </div>
    </div>
  );
}
