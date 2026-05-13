"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunSyncButton({ ruleId, children }: { ruleId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    await fetch("/api/sync/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syncRuleId: ruleId }),
    });
    setRunning(false);
    router.refresh();
  }

  return (
    <button onClick={run} disabled={running} className="inline-flex items-center justify-center gap-2 rounded-md bg-[#18181b] px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
      {running ? "Running..." : children}
    </button>
  );
}
