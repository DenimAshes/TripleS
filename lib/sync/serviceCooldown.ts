import { prisma } from "@/lib/db/prisma";
import { cooldownMsForFailureCount, isCooldownError } from "./failureClassifier";

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
  await prisma.$transaction(async (tx) => {
    const existing = await tx.serviceCooldown.findUnique({ where: { service: key } });
    const failureCount = (existing?.failureCount ?? 0) + 1;
    const until = new Date(now.getTime() + cooldownMsForFailureCount(failureCount));
    await tx.serviceCooldown.upsert({
      where: { service: key },
      update: {
        until,
        reason,
        failureCount,
        lastFailureAt: now,
      },
      create: {
        service: key,
        until,
        reason,
        failureCount,
        lastFailureAt: now,
      },
    });
  });
}

export async function markServiceSuccess(service: string, now: Date = new Date()): Promise<void> {
  const key = toServiceKey(service);
  await prisma.serviceCooldown.upsert({
    where: { service: key },
    update: {
      until: now,
      reason: null,
      failureCount: 0,
      lastSuccessAt: now,
    },
    create: {
      service: key,
      until: now,
      reason: null,
      failureCount: 0,
      lastSuccessAt: now,
    },
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

export async function recordSuccessForRule(services: string[]): Promise<void> {
  await Promise.all(Array.from(new Set(services.map(toServiceKey))).map((service) => markServiceSuccess(service)));
}
