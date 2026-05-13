import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaRetryInstalled?: boolean };

function isTransientConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P1001" || error.code === "P1002" || error.code === "P1017";
  }

  const message = error instanceof Error ? error.message : String(error);
  return /Can't reach database server|Server has closed the connection|Connection terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout/i.test(message);
}

function retryDelayMs(attempt: number): number {
  return 400 * 2 ** attempt;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (!globalForPrisma.prismaRetryInstalled) {
  prisma.$use(async (params, next) => {
    const maxAttempts = Number(process.env.PRISMA_TRANSIENT_RETRIES || 2) + 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await next(params);
      } catch (error) {
        if (attempt >= maxAttempts - 1 || !isTransientConnectionError(error)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
      }
    }
    return next(params);
  });
  globalForPrisma.prismaRetryInstalled = true;
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
