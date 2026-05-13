import type { Locator, Page } from "playwright";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(baseMs: number, spreadMs: number): Promise<void> {
  const offset = Math.floor(Math.random() * Math.max(0, spreadMs));
  return sleep(baseMs + offset);
}

export async function humanDwell(minMs = 400, maxMs = 1800): Promise<void> {
  await jitter(minMs, Math.max(0, maxMs - minMs));
}

export async function humanHoverClick(
  page: Page,
  locator: Locator,
  options: { timeout?: number; force?: boolean } = {},
): Promise<void> {
  void page;
  await locator.hover({ timeout: options.timeout ?? 10_000 }).catch(() => {});
  await humanDwell(300, 1400);
  await locator.click({ timeout: options.timeout ?? 10_000, force: options.force });
}
