import { spawnSync } from "node:child_process";

if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
  console.log("[migrate] Using DIRECT_URL for prisma migrate deploy.");
} else {
  console.log("[migrate] DIRECT_URL is not set; using DATABASE_URL for prisma migrate deploy.");
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

process.exit(result.status ?? 1);
