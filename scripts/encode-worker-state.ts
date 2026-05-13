import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const service = process.argv[2];
if (service !== "youtube" && service !== "soundcloud") {
  throw new Error("Usage: npm run --silent state:encode -- youtube|soundcloud");
}

const file = path.resolve(process.cwd(), "worker", "state", `${service}.json`);
const json = fs.readFileSync(file, "utf8");
JSON.parse(json);
process.stdout.write(gzipSync(Buffer.from(json, "utf8")).toString("base64"));
