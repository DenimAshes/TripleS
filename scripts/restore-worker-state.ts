import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { prisma } from "@/lib/db/prisma";

type StateTarget = {
  service: "youtube" | "soundcloud" | "spotify";
  gzipEnvName: string;
  legacyEnvName: string;
};

const targets: StateTarget[] = [
  { service: "youtube", gzipEnvName: "YOUTUBE_STATE_GZIP_BASE64", legacyEnvName: "YOUTUBE_STATE_JSON_BASE64" },
  { service: "soundcloud", gzipEnvName: "SOUNDCLOUD_STATE_GZIP_BASE64", legacyEnvName: "SOUNDCLOUD_STATE_JSON_BASE64" },
  { service: "spotify", gzipEnvName: "SPOTIFY_STATE_GZIP_BASE64", legacyEnvName: "SPOTIFY_STATE_JSON_BASE64" },
];

const stateDir = path.resolve(process.cwd(), "worker", "state");

function decodeLegacyState(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return trimmed;
  return Buffer.from(trimmed, "base64").toString("utf8");
}

function decodeGzipState(value: string): string {
  return gunzipSync(Buffer.from(value.trim(), "base64")).toString("utf8");
}

function assertJson(value: string, source: string): void {
  try {
    JSON.parse(value);
  } catch {
    throw new Error(`${source} does not decode to valid JSON.`);
  }
}

async function restoreFromDb(target: StateTarget): Promise<string | null> {
  try {
    const row = await prisma.workerSessionState.findUnique({ where: { service: target.service } });
    if (!row) return null;
    const json = decodeGzipState(row.stateGzipBase64);
    assertJson(json, `DB.WorkerSessionState[${target.service}]`);
    console.log(`[state] ${target.service}: loaded from DB (updated ${row.updatedAt.toISOString()}, ${row.bytes} bytes).`);
    return json;
  } catch (error) {
    console.warn(`[state] ${target.service}: DB lookup failed — ${error instanceof Error ? error.message : String(error)}. Falling back to env.`);
    return null;
  }
}

function restoreFromEnv(target: StateTarget): string | null {
  const gzipValue = process.env[target.gzipEnvName];
  const legacyValue = process.env[target.legacyEnvName];
  if (!gzipValue && !legacyValue) return null;
  const envName = gzipValue ? target.gzipEnvName : target.legacyEnvName;
  const json = gzipValue ? decodeGzipState(gzipValue) : decodeLegacyState(legacyValue ?? "");
  assertJson(json, envName);
  console.log(`[state] ${target.service}: loaded from env ${envName}.`);
  return json;
}

async function main() {
  fs.mkdirSync(stateDir, { recursive: true });

  for (const target of targets) {
    const json = (await restoreFromDb(target)) ?? restoreFromEnv(target);
    if (!json) {
      console.log(`[state] ${target.service}: no source available (DB row missing, env secrets empty). Skipping.`);
      continue;
    }
    const outFile = path.join(stateDir, `${target.service}.json`);
    fs.writeFileSync(outFile, json, { encoding: "utf8", mode: 0o600 });
    console.log(`[state] ${target.service}: wrote ${outFile}.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
