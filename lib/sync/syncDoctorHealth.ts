export type SyncDoctorStatus = "OK" | "WARN" | "FAIL";

export function classifyRecentJobStatuses(statuses: string[]): SyncDoctorStatus {
  if (statuses[0] !== "FAILED") return "OK";
  return statuses[1] === "FAILED" ? "FAIL" : "WARN";
}
