// Minimal structured logger.
//
// Enable verbose adapter/CLI logs with one of:
//   DEBUG=triples:* (or specific scopes like triples:adapter)
//   TRIPLES_LOG_LEVEL=debug
//
// In production the default level is "info", so "debug" lines stay silent.

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function activeLevel(): Level {
  const explicit = (process.env.TRIPLES_LOG_LEVEL || "").toLowerCase();
  if (explicit === "debug" || explicit === "info" || explicit === "warn" || explicit === "error") {
    return explicit as Level;
  }
  return process.env.NODE_ENV === "production" ? "info" : "info";
}

function scopeEnabled(scope: string): boolean {
  const debugEnv = process.env.DEBUG || "";
  if (!debugEnv) return false;
  return debugEnv
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((pattern) => {
      if (pattern === "*") return true;
      if (pattern.endsWith(":*")) return scope.startsWith(pattern.slice(0, -1));
      return pattern === scope;
    });
}

function shouldEmit(scope: string, level: Level): boolean {
  if (scopeEnabled(scope)) return true;
  return LEVEL_RANK[level] >= LEVEL_RANK[activeLevel()];
}

function emit(scope: string, level: Level, message: string, extra?: Record<string, unknown>): void {
  if (!shouldEmit(scope, level)) return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  const line = `[${scope}] ${message}${payload}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, extra?: Record<string, unknown>) => emit(scope, "debug", message, extra),
    info: (message: string, extra?: Record<string, unknown>) => emit(scope, "info", message, extra),
    warn: (message: string, extra?: Record<string, unknown>) => emit(scope, "warn", message, extra),
    error: (message: string, extra?: Record<string, unknown>) => emit(scope, "error", message, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
