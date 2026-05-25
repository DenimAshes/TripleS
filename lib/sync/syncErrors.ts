export type SyncErrorCode =
  | "SOURCE_CACHE_INCOMPLETE"
  | "SOURCE_NOT_FOUND"
  | "DESTINATION_NOT_FOUND"
  | "DESTINATION_NOT_WRITABLE"
  | "NO_DESTINATIONS"
  | "BROWSER_SESSION_MISSING"
  | "BROWSER_SESSION_EXPIRED"
  | "RUNNER_TIMEOUT"
  | "CAPTCHA_BLOCKED"
  | "RATE_LIMITED"
  | "PLAYLIST_NOT_FOUND"
  | "DB_SCHEMA_MISMATCH"
  | "ALREADY_RUNNING"
  | "CANCELLED"
  | "UNKNOWN";

export type SyncErrorDetails = {
  service?: string;
  playlistId?: string;
  sourcePlaylistId?: string;
  activeTracks?: number;
  expectedTracks?: number;
  recommendedAction?: string;
  hint?: string;
  rawMessage?: string;
};

export class SyncError extends Error {
  public readonly code: SyncErrorCode;
  public readonly details: SyncErrorDetails;
  public readonly httpStatus: number;

  constructor(code: SyncErrorCode, message: string, details: SyncErrorDetails = {}, httpStatus = 400) {
    super(message);
    this.name = "SyncError";
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }

  toJSON() {
    return { code: this.code, error: this.message, details: this.details };
  }
}

export function isSyncError(error: unknown): error is SyncError {
  return error instanceof SyncError;
}

export function classifySyncError(error: unknown): SyncError {
  if (isSyncError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof Error && error.name === "CancelledError") {
    return new SyncError("CANCELLED", message || "Cancelled", { rawMessage: message });
  }
  if (/cancelled|aborted/i.test(message)) {
    return new SyncError("CANCELLED", message, { rawMessage: message });
  }
  if (/captcha|anti-abuse|blocked the (write|create) request/i.test(message)) {
    return new SyncError("CAPTCHA_BLOCKED", message, {
      rawMessage: message,
      recommendedAction: "Re-warm the session or wait for cooldown.",
    });
  }
  if (/timed out|timeout|TIMEOUT|SIGTERM|killed/i.test(message)) {
    return new SyncError("RUNNER_TIMEOUT", message, {
      rawMessage: message,
      recommendedAction: "Retry; if it persists, increase the runner timeout or use a persistent browser service.",
    });
  }
  if (/Too Many Requests|rate limit|429/i.test(message)) {
    return new SyncError("RATE_LIMITED", message, {
      rawMessage: message,
      recommendedAction: "Wait for the cooldown to elapse.",
    });
  }
  if (/not logged in|not signed in|No saved .* browser session/i.test(message)) {
    return new SyncError("BROWSER_SESSION_MISSING", message, {
      rawMessage: message,
      recommendedAction: "Re-login and save the worker browser session.",
    });
  }
  if (/session expired|signed out|login required/i.test(message)) {
    return new SyncError("BROWSER_SESSION_EXPIRED", message, {
      rawMessage: message,
      recommendedAction: "Re-login and save the worker browser session.",
    });
  }
  if (/does not exist in the current database|column .* does not exist/i.test(message)) {
    return new SyncError("DB_SCHEMA_MISMATCH", message, {
      rawMessage: message,
      recommendedAction: "Run prisma migrate deploy and prisma generate.",
    });
  }
  if (/Playlist not found|SyncRule not found|No sync rule found/i.test(message)) {
    return new SyncError("PLAYLIST_NOT_FOUND", message, { rawMessage: message });
  }
  if (/Could not acquire advisory lock|already has a RUNNING job|already has a RUNNING sync job|already running|already starting/i.test(message)) {
    return new SyncError("ALREADY_RUNNING", message, {
      rawMessage: message,
      recommendedAction: "Wait for the current sync to finish.",
    }, 409);
  }
  if (/Preflight failed/i.test(message)) {
    const reason = message.split(":").slice(1).join(":").trim() || message;
    const mapped = preflightReasonToCode(reason);
    return new SyncError(mapped.code, reason, { ...mapped.details, rawMessage: message }, 409);
  }

  return new SyncError("UNKNOWN", message, { rawMessage: message });
}

export function preflightReasonToCode(reason: string): { code: SyncErrorCode; details: SyncErrorDetails } {
  if (/source playlist .* is not cached/i.test(reason)) {
    return { code: "SOURCE_NOT_FOUND", details: { recommendedAction: "Refresh source playlist metadata." } };
  }
  if (/incomplete cache|Source snapshot incomplete/i.test(reason)) {
    const slash = reason.match(/\((\d+)\/(\d+)\s+active\)/i);
    const named = reason.match(/active=(\d+).*expected=(\d+)/i);
    return {
      code: "SOURCE_CACHE_INCOMPLETE",
      details: {
        activeTracks: slash ? Number(slash[1]) : named ? Number(named[1]) : undefined,
        expectedTracks: slash ? Number(slash[2]) : named ? Number(named[2]) : undefined,
        recommendedAction: "Refresh source tracks, then re-run sync.",
      },
    };
  }
  if (/cache is stale/i.test(reason)) {
    return {
      code: "SOURCE_CACHE_INCOMPLETE",
      details: { recommendedAction: "Refresh source tracks, then re-run sync." },
    };
  }
  if (/Destination playlist .* is not cached/i.test(reason)) {
    return {
      code: "DESTINATION_NOT_FOUND",
      details: { recommendedAction: "Refresh destination playlists, or remove the destination from the rule." },
    };
  }
  if (/not writable/i.test(reason)) {
    return { code: "DESTINATION_NOT_WRITABLE", details: { recommendedAction: "Pick a writable destination playlist." } };
  }
  if (/No enabled destinations/i.test(reason)) {
    return { code: "NO_DESTINATIONS", details: { recommendedAction: "Enable at least one destination on the rule." } };
  }
  if (/browser session is missing/i.test(reason)) {
    return { code: "BROWSER_SESSION_MISSING", details: { recommendedAction: "Save a fresh worker browser session." } };
  }
  if (/CDP URL is missing/i.test(reason)) {
    return { code: "BROWSER_SESSION_MISSING", details: { recommendedAction: "Set CDP_URL for the affected service." } };
  }
  return { code: "UNKNOWN", details: { hint: reason } };
}
