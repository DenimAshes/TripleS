import fs from "node:fs";
import path from "node:path";

type StateTarget = {
  service: "youtube" | "soundcloud";
  envName: string;
};

const targets: StateTarget[] = [
  { service: "youtube", envName: "YOUTUBE_STATE_JSON_BASE64" },
  { service: "soundcloud", envName: "SOUNDCLOUD_STATE_JSON_BASE64" },
];

const stateDir = path.resolve(process.cwd(), "worker", "state");

function decodeState(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return trimmed;
  return Buffer.from(trimmed, "base64").toString("utf8");
}

function assertJson(value: string, envName: string): void {
  try {
    JSON.parse(value);
  } catch {
    throw new Error(`${envName} is not valid JSON or base64-encoded JSON.`);
  }
}

function main() {
  fs.mkdirSync(stateDir, { recursive: true });

  for (const target of targets) {
    const raw = process.env[target.envName];
    if (!raw) {
      console.log(`[state] ${target.envName} is empty; skipping ${target.service}.`);
      continue;
    }

    const json = decodeState(raw);
    assertJson(json, target.envName);
    const outFile = path.join(stateDir, `${target.service}.json`);
    fs.writeFileSync(outFile, json, { encoding: "utf8", mode: 0o600 });
    console.log(`[state] restored ${target.service} state to ${outFile}.`);
  }
}

main();
