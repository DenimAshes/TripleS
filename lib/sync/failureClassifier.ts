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

const SERVICE_NAMES = ["youtube", "spotify", "soundcloud"] as const;
export type FailingService = (typeof SERVICE_NAMES)[number];

type ServiceAttributedError = Error & { service?: string };

/**
 * Tags an error with the service whose runner produced it. Without this the
 * only clue is the message text, and bookkeeping ends up cooling down every
 * service on the rule — including the one that worked.
 */
export function attributeErrorToService<E extends Error>(error: E, service: string): E {
  (error as ServiceAttributedError).service = service.toLowerCase();
  return error;
}

function mentionsServiceName(message: string, service: string): boolean {
  const haystack = message.toLowerCase();
  const isWordChar = (char: string | undefined) => char !== undefined && /[a-z0-9]/.test(char);
  for (let index = haystack.indexOf(service); index >= 0; index = haystack.indexOf(service, index + 1)) {
    if (!isWordChar(haystack[index - 1]) && !isWordChar(haystack[index + service.length])) return true;
  }
  return false;
}

/**
 * Resolves the failing service from an explicit tag, falling back to the
 * message only when exactly one service is named there — "YouTube -> SoundCloud"
 * style text must not be read as an attribution.
 */
export function serviceFromError(error: unknown): FailingService | null {
  const tagged = (error as ServiceAttributedError | null)?.service;
  if (typeof tagged === "string") {
    const match = SERVICE_NAMES.find((service) => service === tagged.toLowerCase());
    if (match) return match;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  const mentioned = SERVICE_NAMES.filter((service) => mentionsServiceName(message, service));
  return mentioned.length === 1 ? mentioned[0] : null;
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
