import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { prisma } from "@/lib/db/prisma";
import {
  SESSION_SERVICES,
  type SessionService,
  decodeStorageState,
  isSessionService,
  normalizeStorageState,
  sessionCookiesPresent,
  upsertWorkerSessionState,
} from "@/lib/services/workerSessionState";

const stateDir = path.resolve(process.cwd(), "worker", "state");

function usage(): never {
  console.error(
    [
      "Usage: npm run state:push -- <youtube|spotify|soundcloud>... [--all] [--dry-run]",
      "",
      "Reads worker/state/<service>.json and stores it in WorkerSessionState, which is",
      "what scripts/restore-worker-state.ts prefers over the *_STATE_GZIP_BASE64 secrets.",
      "The previous row is written to worker/state/<service>-backup-<timestamp>.json first.",
    ].join("\n"),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): { services: SessionService[]; dryRun: boolean } {
  const dryRun = argv.includes("--dry-run");
  const rest = argv.filter((arg) => !arg.startsWith("--"));
  if (argv.includes("--all")) return { services: [...SESSION_SERVICES], dryRun };
  if (!rest.length) usage();
  const services: SessionService[] = [];
  for (const arg of rest) {
    if (!isSessionService(arg)) {
      console.error(`Unknown service "${arg}". Expected one of: ${SESSION_SERVICES.join(", ")}.`);
      process.exit(1);
    }
    if (!services.includes(arg)) services.push(arg);
  }
  return { services, dryRun };
}

function stampedBackupPath(service: SessionService, updatedAt: Date): string {
  const stamp = updatedAt.toISOString().replace(/[:.]/g, "-");
  return path.join(stateDir, `${service}-backup-${stamp}.json`);
}

async function pushService(service: SessionService, dryRun: boolean): Promise<boolean> {
  const file = path.join(stateDir, `${service}.json`);
  if (!fs.existsSync(file)) {
    console.log(`[state:push] ${service}: no local ${path.relative(process.cwd(), file)}. Sign in first, then retry.`);
    return false;
  }

  let state;
  try {
    state = normalizeStorageState(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    console.error(`[state:push] ${service}: ${path.relative(process.cwd(), file)} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  if (!state) {
    console.error(`[state:push] ${service}: ${path.relative(process.cwd(), file)} has no usable cookies.`);
    return false;
  }

  const localCookies = sessionCookiesPresent(service, state);
  console.log(
    `[state:push] ${service}: local file has ${state.cookies.length} cookie(s); session cookies present: ${localCookies.join(", ") || "(none recognized)"}`,
  );
  if (!localCookies.length) {
    console.warn(
      `[state:push] ${service}: none of the known session cookies are present. The worker will restore this state and still fail as logged out.`,
    );
  }

  const existing = await prisma.workerSessionState.findUnique({ where: { service } });
  if (existing) {
    const previous = (() => {
      try {
        return decodeStorageState(existing.stateGzipBase64);
      } catch {
        return null;
      }
    })();
    console.log(
      `[state:push] ${service}: stored row from ${existing.updatedAt.toISOString()} has ${previous?.cookies.length ?? "?"} cookie(s); session cookies present: ${
        previous ? sessionCookiesPresent(service, previous).join(", ") || "(none recognized)" : "(unreadable)"
      }`,
    );
    if (!dryRun) {
      const backup = stampedBackupPath(service, existing.updatedAt);
      fs.writeFileSync(backup, JSON.stringify(previous ?? { stateGzipBase64: existing.stateGzipBase64 }, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      console.log(`[state:push] ${service}: backed up previous row to ${path.relative(process.cwd(), backup)}`);
    }
  } else {
    console.log(`[state:push] ${service}: no stored row yet.`);
  }

  if (dryRun) {
    console.log(`[state:push] ${service}: --dry-run, nothing written.`);
    return true;
  }

  const stored = await upsertWorkerSessionState({
    service,
    state,
    updatedBy: `state:push@${os.hostname()}`,
  });
  console.log(
    `[state:push] ${service}: stored ${stored.cookies} cookie(s), ${stored.bytes} bytes at ${stored.updatedAt.toISOString()}.`,
  );
  return true;
}

async function main() {
  const { services, dryRun } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(stateDir, { recursive: true });

  let pushed = 0;
  for (const service of services) {
    if (await pushService(service, dryRun)) pushed += 1;
  }
  console.log(`[state:push] done: ${pushed}/${services.length} service(s)${dryRun ? " (dry run)" : ""}.`);
  if (pushed === 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
