import { spawnSync } from "node:child_process";

type ServiceName = "youtube" | "soundcloud";

type HealthResult = {
  service: ServiceName;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
};

const SERVICES: ServiceName[] = ["youtube", "soundcloud"];

function serviceFromArg(): ServiceName | "all" {
  const value = process.argv[2] || "all";
  if (value === "youtube" || value === "soundcloud" || value === "all") return value;
  throw new Error("Usage: npm run browser:recover -- youtube|soundcloud|all [--restart]");
}

function restartEnabled(): boolean {
  return process.argv.includes("--restart") || process.env.BROWSER_RECOVER_RESTART === "true";
}

function cdpUrl(service: ServiceName): string {
  return process.env[`CDP_URL_${service.toUpperCase()}`] || (service === "youtube" ? "http://127.0.0.1:9222" : "http://127.0.0.1:9223");
}

async function check(service: ServiceName): Promise<HealthResult> {
  const url = new URL("/json/version", cdpUrl(service)).toString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return {
      service,
      url,
      ok: response.ok,
      status: response.status,
      error: response.ok ? undefined : (await response.text()).slice(0, 200),
    };
  } catch (error) {
    return {
      service,
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function composeService(service: ServiceName): string {
  return service === "youtube" ? "browser-youtube" : "browser-soundcloud";
}

function restart(service: ServiceName): void {
  const result = spawnSync(
    "docker",
    ["compose", "-f", "docker-compose.vm.yml", "--profile", "browser", "restart", composeService(service)],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (result.status !== 0) {
    throw new Error(`docker compose restart failed for ${service} with status ${result.status}`);
  }
}

async function main() {
  const target = serviceFromArg();
  const services = target === "all" ? SERVICES : [target];
  const results = await Promise.all(services.map(check));

  for (const result of results) {
    const marker = result.ok ? "OK" : "FAIL";
    console.log(`[${marker}] ${result.service}: ${result.url}`);
    if (result.error) console.log(`  ${result.error}`);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) return;

  if (!restartEnabled()) {
    console.log("Recovery is dry-run only. Re-run with --restart to restart failed browser services.");
    process.exitCode = 1;
    return;
  }

  for (const result of failed) {
    console.log(`[recover] restarting ${result.service}`);
    restart(result.service);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
