export type RunnerGuardOptions = {
  env?: Record<string, string | undefined>;
};

const NEXT_RUNTIME_MARKERS = ["NEXT_RUNTIME", "NEXT_PHASE"] as const;

function nodeEnv(value: string | undefined): NodeJS.ProcessEnv["NODE_ENV"] {
  return value === "production" || value === "test" ? value : "development";
}

export function isRunnerCli(env: Record<string, string | undefined> = process.env): boolean {
  return env.WORKER_RUNNER_CLI === "true";
}

export function allowsDirectRunnerImport(env: Record<string, string | undefined> = process.env): boolean {
  return env.ALLOW_DIRECT_WORKER_RUNNER_IMPORT === "true";
}

export function detectsNextServer(env: Record<string, string | undefined> = process.env): boolean {
  return NEXT_RUNTIME_MARKERS.some((key) => Boolean(env[key]));
}

export function assertRunnerCli(options: RunnerGuardOptions = {}): void {
  const env = options.env ?? process.env;
  if (isRunnerCli(env) || allowsDirectRunnerImport(env)) return;
  if (!detectsNextServer(env)) return;

  const markers = NEXT_RUNTIME_MARKERS.filter((key) => env[key]).join(", ");
  throw new Error(
    `[runnerGuard] Worker runners must not be imported from app/server code. Detected: ${markers}. ` +
      "Spawn them via runBrowserRunnerCli, which sets WORKER_RUNNER_CLI=true.",
  );
}

export function sanitizeRunnerEnv(
  parentEnv: Record<string, string | undefined> = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...parentEnv,
    NODE_ENV: nodeEnv(parentEnv.NODE_ENV ?? process.env.NODE_ENV),
    WORKER_RUNNER_CLI: "true",
  };
  for (const marker of NEXT_RUNTIME_MARKERS) delete env[marker];
  return env;
}
