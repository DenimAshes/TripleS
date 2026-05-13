export const FAILURE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function isCooldownError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /captcha|anti-abuse|blocked the write|not logged in|not signed in|No saved .* browser session/i.test(message);
}

export function nextRunAfterFailure(intervalMinutes: number, error: unknown, now: Date = new Date()): Date | null {
  if (isCooldownError(error)) return new Date(now.getTime() + FAILURE_COOLDOWN_MS);
  return intervalMinutes > 0 ? new Date(now.getTime() + intervalMinutes * 60_000) : null;
}
