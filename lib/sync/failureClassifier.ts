export const FAILURE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function cooldownMsForFailureCount(failureCount: number): number {
  if (failureCount <= 1) return 6 * 60 * 60 * 1000;
  if (failureCount === 2) return 24 * 60 * 60 * 1000;
  return 72 * 60 * 60 * 1000;
}

export function isCooldownError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /captcha|anti-abuse|blocked the write|not logged in|not signed in|No saved .* browser session|SoundCloud API 403|HTTP 403|403 Forbidden/i.test(message);
}

export type FailureKind = "captcha" | "rate_limit" | "timeout" | "network" | "auth" | "transient" | "unknown";

export function classifyError(error: unknown): FailureKind {
  const message = error instanceof Error ? error.message : String(error);
  if (/captcha|anti-abuse|blocked the write/i.test(message)) return "captcha";
  if (/\b(429|rate.?limit|too many requests)\b/i.test(message)) return "rate_limit";
  if (/not logged in|not signed in|No saved .* browser session|session is missing|session expired|401|403/i.test(message)) return "auth";
  if (/timed out|ETIMEDOUT|SIGTERM|killed|ECONNABORTED/i.test(message)) return "timeout";
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i.test(message)) return "network";
  if (/5\d\d/.test(message)) return "transient";
  return "unknown";
}

export function isRetryableError(error: unknown): boolean {
  const kind = classifyError(error);
  return kind === "timeout" || kind === "network" || kind === "rate_limit" || kind === "transient";
}

export function isHardBlockError(error: unknown): boolean {
  const kind = classifyError(error);
  return kind === "captcha" || kind === "auth";
}

export function recommendedActionForFailure(error: unknown): string {
  const kind = classifyError(error);
  if (kind === "captcha") return "Open the saved browser profile, solve the challenge, then retry the sync.";
  if (kind === "auth") return "Refresh the browser session or reconnect the account before retrying.";
  if (kind === "timeout") return "Retry once; if it repeats, check the browser worker and increase the runner timeout.";
  if (kind === "rate_limit") return "Wait for the service cooldown to expire before retrying.";
  if (kind === "network") return "Retry after the network or upstream service stabilizes.";
  if (kind === "transient") return "Retry later; the upstream service returned a temporary failure.";
  return "Check the worker logs for the exact runner failure.";
}

export function nextRunAfterFailure(intervalMinutes: number, error: unknown, now: Date = new Date()): Date | null {
  if (isCooldownError(error)) return new Date(now.getTime() + cooldownMsForFailureCount(1));
  return intervalMinutes > 0 ? new Date(now.getTime() + intervalMinutes * 60_000) : null;
}
