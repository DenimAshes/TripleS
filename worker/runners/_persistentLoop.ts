// Shared helper for browser runners to optionally run as a long-lived
// command server instead of a single-command CLI. When the runner is
// spawned with --persistent (or PERSISTENT_RUNNER=true), the script keeps
// the cloak browser context warm across multiple commands sent over
// newline-delimited JSON on stdin.
//
// Wire protocol (one JSON object per line):
//   Request:  {"id": "<opaque>", "command": "<name>", "args": [...]}
//   Response: {"id": "<opaque>", "ok": true,  "result": <json>}
//        or:  {"id": "<opaque>", "ok": false, "error": "<message>"}
//
// One in-flight request at a time. The parent process must wait for the
// response with the matching id before sending the next command — the
// loop processes lines serially so the browser session is never accessed
// from two callers at once.

import readline from "node:readline";

export type PersistentCommandHandler = (command: string, args: unknown[]) => Promise<unknown>;

export function isPersistentMode(): boolean {
  return process.argv.includes("--persistent") || process.env.PERSISTENT_RUNNER === "true";
}

export async function runPersistentLoop(handler: PersistentCommandHandler): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin });
  // Emit a marker so the client knows the loop is ready to take commands.
  process.stdout.write(JSON.stringify({ ready: true }) + "\n");

  const pending: string[] = [];
  let processing = false;

  const drain = async () => {
    if (processing) return;
    processing = true;
    try {
      while (pending.length) {
        const line = pending.shift()!;
        const trimmed = line.trim();
        if (!trimmed) continue;
        let request: { id?: unknown; command?: unknown; args?: unknown };
        try {
          request = JSON.parse(trimmed);
        } catch (parseError) {
          process.stdout.write(
            JSON.stringify({ ok: false, error: `bad request: ${parseError instanceof Error ? parseError.message : String(parseError)}` }) + "\n",
          );
          continue;
        }
        const id = typeof request.id === "string" ? request.id : null;
        const command = typeof request.command === "string" ? request.command : "";
        const args = Array.isArray(request.args) ? request.args : [];
        if (!command) {
          process.stdout.write(JSON.stringify({ id, ok: false, error: "command is required" }) + "\n");
          continue;
        }
        try {
          const result = await handler(command, args);
          process.stdout.write(JSON.stringify({ id, ok: true, result: result ?? null }) + "\n");
        } catch (error) {
          process.stdout.write(
            JSON.stringify({ id, ok: false, error: error instanceof Error ? error.message : String(error) }) + "\n",
          );
        }
      }
    } finally {
      processing = false;
    }
  };

  rl.on("line", (line) => {
    pending.push(line);
    void drain();
  });

  await new Promise<void>((resolve) => {
    rl.on("close", () => resolve());
  });
  // Ensure last command completes before exit.
  while (processing) await new Promise((r) => setTimeout(r, 20));
}
