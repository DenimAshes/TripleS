#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const scripts = packageJson.scripts || {};

const PROCESS_DEFINITIONS = [
  {
    name: "sync-worker",
    command: "npm",
    args: ["run", "sync-worker"],
    enabled: process.env.SYNC_WORKER_DISABLED !== "true",
    requiredScript: "sync-worker",
  },
  {
    name: "browser-job-worker",
    command: "npm",
    args: ["run", "browser-job-worker"],
    enabled: process.env.BROWSER_JOB_WORKER_ENABLED === "true",
    requiredScript: "browser-job-worker",
  },
];

const RESTART_BACKOFF_MS = Math.max(1000, Number(process.env.WORKER_SUPERVISOR_BACKOFF_MS || 5000));
const SUCCESS_BACKOFF_MS = Math.max(1000, Number(process.env.WORKER_SUPERVISOR_SUCCESS_BACKOFF_MS || 60_000));
const MAX_FAILURES = Math.max(0, Number(process.env.WORKER_SUPERVISOR_MAX_FAILURES || 5));

let shuttingDown = false;
const children = new Map();

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker-supervisor] received ${signal}, stopping children`);
  for (const child of children.values()) {
    try {
      child.kill(signal);
    } catch (error) {
      console.warn(`[worker-supervisor] failed to stop child: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  setTimeout(() => process.exit(process.exitCode || 0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function launch(definition, failures = 0) {
  if (!definition.enabled) {
    console.log(`[worker-supervisor] ${definition.name} disabled`);
    return;
  }
  if (!scripts[definition.requiredScript]) {
    console.log(`[worker-supervisor] ${definition.name} skipped; package script "${definition.requiredScript}" is not defined`);
    return;
  }

  console.log(`[worker-supervisor] starting ${definition.name}`);
  const child = spawn(definition.command, definition.args, {
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
    windowsHide: true,
  });
  children.set(definition.name, child);

  child.on("exit", (code, signal) => {
    children.delete(definition.name);
    console.log(`[worker-supervisor] ${definition.name} exited code=${code} signal=${signal}`);
    if (shuttingDown) return;
    const nextFailures = code === 0 ? 0 : failures + 1;
    if (nextFailures > MAX_FAILURES) {
      console.error(`[worker-supervisor] ${definition.name} exceeded failure limit (${MAX_FAILURES})`);
      process.exitCode = 1;
      shutdown("SIGTERM");
      return;
    }
    const delay = code === 0 ? SUCCESS_BACKOFF_MS : RESTART_BACKOFF_MS;
    setTimeout(() => launch(definition, nextFailures), delay).unref();
  });

  child.on("error", (error) => {
    console.error(`[worker-supervisor] failed to start ${definition.name}: ${error.message}`);
  });
}

for (const definition of PROCESS_DEFINITIONS) {
  launch(definition);
}
