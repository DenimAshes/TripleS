import { spawnSync } from "node:child_process";

const maxAttempts = Number(process.env.MIGRATE_DEPLOY_ATTEMPTS || 3);
const retryDelayMs = Number(process.env.MIGRATE_DEPLOY_RETRY_DELAY_MS || 5000);

if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
  console.log("[migrate] Using DIRECT_URL for prisma migrate deploy.");
} else {
  console.log("[migrate] DIRECT_URL is not set; skipping prisma migrate deploy during build.");
  console.log("[migrate] Run `npx prisma migrate deploy` manually with a direct database URL when migrations are needed.");
  process.exit(0);
}

process.env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK ??= "1";

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`[migrate] prisma migrate deploy attempt ${attempt}/${maxAttempts}.`);
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  const status = result.status ?? 1;
  if (status === 0) process.exit(0);
  if (attempt === maxAttempts) process.exit(status);

  console.log(`[migrate] migrate deploy failed with status ${status}; retrying in ${retryDelayMs}ms.`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
}
