"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteRuleButton({ ruleId }: { ruleId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    const response = await fetch(`/api/sync-rules/${ruleId}`, { method: "DELETE" });
    setDeleting(false);
    if (response.ok) {
      router.push("/settings");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={deleting}
      className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
    >
      <Trash2 size={16} /> {deleting ? "Deleting..." : "Delete"}
    </button>
  );
}
