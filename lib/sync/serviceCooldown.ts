import { prisma } from "@/lib/db/prisma";
import { FAILURE_COOLDOWN_MS, isCooldownError } from "./failureClassifier";

export type DestinationService = "SPOTIFY" | "YOUTUBE" | "SOUNDCLOUD";

function toServiceKey(service: string): string {
  return service.toLowerCase();
}

export async function getServicesInCooldown(now: Date = new Date()): Promise<Set<string>> {
  const rows = await prisma.serviceCooldown.findMany({ where: { until: { gt: now } } });
  return new Set(rows.map((row) => row.service));
}

export async function setServiceCooldown(service: string, reason: string, now: Date = new Date()): Promise<void> {
  const key = toServiceKey(service);
  const until = new Date(now.getTime() + FAILURE_COOLDOWN_MS);
  await prisma.serviceCooldown.upsert({
    where: { service: key },
    update: { until, reason },
    create: { service: key, until, reason },
  });
}

export async function recordCooldownForRule(
  destinationServices: string[],
  error: unknown,
): Promise<void> {
  if (!isCooldownError(error)) return;
  const message = error instanceof Error ? error.message : String(error);
  await Promise.all(
    Array.from(new Set(destinationServices.map(toServiceKey))).map((service) =>
      setServiceCooldown(service, message),
    ),
  );
}
