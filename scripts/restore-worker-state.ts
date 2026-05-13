import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

type StateTarget = {
  service: "youtube" | "soundcloud";
  gzipEnvName: string;
  legacyEnvName: string;
};

const targets: StateTarget[] = [
  {
    service: "youtube",
    gzipEnvName: "YOUTUBE_STATE_GZIP_BASE64",
    legacyEnvName: "YOUTUBE_STATE_JSON_BASE64",
  },
  {
    service: "soundcloud",
    gzipEnvName: "SOUNDCLOUD_STATE_GZIP_BASE64",
    legacyEnvName: "SOUNDCLOUD_STATE_JSON_BASE64",
  },
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

function assertJson(value: string, envName: string): void {
  try {
    JSON.parse(value);
  } catch {
    throw new Error(`${envName} does not decode to valid JSON.`);
  }
}

function main() {
  fs.mkdirSync(stateDir, { recursive: true });

  for (const target of targets) {
    const gzipValue = process.env[target.gzipEnvName];
    const legacyValue = process.env[target.legacyEnvName];
    if (!gzipValue && !legacyValue) {
      console.log(
        `[state] ${target.gzipEnvName} and ${target.legacyEnvName} are empty; skipping ${target.service}.`,
      );
      continue;
    }

    const envName = gzipValue ? target.gzipEnvName : target.legacyEnvName;
    const json = gzipValue ? decodeGzipState(gzipValue) : decodeLegacyState(legacyValue ?? "");
    assertJson(json, envName);
    const outFile = path.join(stateDir, `${target.service}.json`);
    fs.writeFileSync(outFile, json, { encoding: "utf8", mode: 0o600 });
    console.log(`[state] restored ${target.service} state to ${outFile}.`);
  }
}

main();
