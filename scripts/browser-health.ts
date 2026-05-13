type HealthResult = {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  browser?: string;
  webSocketDebuggerUrl?: string;
  error?: string;
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function configuredTargets(): Array<{ name: string; url: string }> {
  const explicit = argValue("--url") || process.env.CDP_URL;
  if (explicit) return [{ name: "browser", url: explicit }];

  return [
    { name: "youtube", url: process.env.CDP_URL_YOUTUBE || "http://127.0.0.1:9222" },
    { name: "soundcloud", url: process.env.CDP_URL_SOUNDCLOUD || "http://127.0.0.1:9223" },
  ];
}

async function checkTarget(name: string, baseUrl: string): Promise<HealthResult> {
  const url = new URL("/json/version", baseUrl).toString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    if (!response.ok) return { name, url, ok: false, status: response.status, error: text.slice(0, 200) };
    const data = JSON.parse(text) as { Browser?: string; webSocketDebuggerUrl?: string };
    return {
      name,
      url,
      ok: true,
      status: response.status,
      browser: data.Browser,
      webSocketDebuggerUrl: data.webSocketDebuggerUrl,
    };
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const results = await Promise.all(configuredTargets().map((target) => checkTarget(target.name, target.url)));
  for (const result of results) {
    const marker = result.ok ? "OK" : "FAIL";
    console.log(`[${marker}] ${result.name}: ${result.url}`);
    console.log(JSON.stringify(result, null, 2));
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
