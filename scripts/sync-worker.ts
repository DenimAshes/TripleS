import { prisma } from "@/lib/db/prisma";
import { runSync } from "@/lib/sync/syncEngine";
import { getServicesInCooldown } from "@/lib/sync/serviceCooldown";
import { preflightSyncRule } from "@/lib/sync/preflight";

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function currentHour(timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone });
  return Number(fmt.format(new Date()));
}

function activeHoursDecision(): { skip: boolean; reason: string } {
  const tz = process.env.WORKER_ACCOUNT_TIMEZONE || "Europe/Riga";
  const start = Number(process.env.WORKER_ACTIVE_HOUR_START ?? 7);
  const end = Number(process.env.WORKER_ACTIVE_HOUR_END ?? 24);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 24 || start >= end) {
    return { skip: false, reason: `invalid WORKER_ACTIVE_HOUR_* (start=${start}, end=${end}) — running anyway` };
  }
  let hour: number;
  try {
    hour = currentHour(tz);
  } catch (error) {
    return { skip: false, reason: `failed to resolve timezone ${tz}: ${error instanceof Error ? error.message : String(error)} — running anyway` };
  }
  const active = hour >= start && hour < end;
  return active
    ? { skip: false, reason: `hour ${hour} in ${tz} inside active window [${start}, ${end})` }
    : { skip: true, reason: `hour ${hour} in ${tz} outside active window [${start}, ${end})` };
}

async function main() {
  const window = activeHoursDecision();
  console.log(`[sync-worker] ${window.reason}`);
  if (window.skip) {
    console.log("[sync-worker] Skipping run. Set WORKER_ACTIVE_HOUR_START/END or WORKER_ACCOUNT_TIMEZONE to override.");
    return;
  }

  const dueRules = await prisma.syncRule.findMany({
    where: {
      isEnabled: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
    },
    include: { destinations: { where: { isEnabled: true } } },
  });

  const cooled = await getServicesInCooldown();
  if (cooled.size > 0) {
    console.log(`[sync-worker] Services in cooldown: ${Array.from(cooled).join(", ")}`);
  }

  const notCooled = dueRules.filter((rule) => {
    const services = [rule.sourceService, ...rule.destinations.map((d) => d.service)].map((s) => s.toLowerCase());
    const blocked = services.find((s) => cooled.has(s));
    if (blocked) {
      console.log(`[sync-worker] Skipping ${rule.name} (${rule.id}) — service ${blocked} is in cooldown.`);
      return false;
    }
    return true;
  });

  const runnable: typeof notCooled = [];
  for (const rule of notCooled) {
    const preflight = await preflightSyncRule(rule);
    if (!preflight.ok) {
      console.log(`[sync-worker] Preflight failed for ${rule.name} (${rule.id}): ${preflight.reasons.join("; ")}`);
      continue;
    }
    runnable.push(rule);
  }

  shuffleInPlace(runnable);

  const maxPerRun = Number(process.env.WORKER_MAX_RULES_PER_RUN ?? 0);
  const slice = Number.isFinite(maxPerRun) && maxPerRun > 0 ? runnable.slice(0, maxPerRun) : runnable;
  if (slice.length < runnable.length) {
    console.log(`[sync-worker] Limiting to ${slice.length}/${runnable.length} rules this tick (WORKER_MAX_RULES_PER_RUN=${maxPerRun}).`);
  }

  for (const rule of slice) {
    console.log(`Running sync rule ${rule.name} (${rule.id})`);
    await runSync(rule.id);
  }

  console.log(`Processed ${slice.length} sync rule(s) (out of ${dueRules.length} due, ${runnable.length} runnable).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
