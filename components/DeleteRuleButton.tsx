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
    <button type="button" onClick={remove} disabled={deleting} className="btn btn-danger">
      <Trash2 size={16} /> {deleting ? "Deleting..." : "Delete"}
    </button>
  );
}
