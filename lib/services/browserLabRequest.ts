export class BrowserLabRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "BrowserLabRequestError";
  }
}

function requiredString(body: unknown, field: string, maxLength = 2_000): string {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>)[field] : undefined;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new BrowserLabRequestError(400, `${field} is required.`);
  }
  if (value.length > maxLength) {
    throw new BrowserLabRequestError(400, `${field} is too long.`);
  }
  return value;
}

export function parseYouTubeCreateRequest(body: unknown) {
  return { name: requiredString(body, "name", 150) };
}

export function parseYouTubeDeleteRequest(body: unknown) {
  return { playlistId: requiredString(body, "playlistId") };
}

export function parseYouTubeAddRequest(body: unknown) {
  return {
    playlistId: requiredString(body, "playlistId"),
    query: requiredString(body, "query"),
  };
}

export function parseYouTubeRemoveRequest(body: unknown) {
  return {
    playlistId: requiredString(body, "playlistId"),
    trackText: requiredString(body, "trackText"),
  };
}

export function parsePlaylistRefreshRequest(body: unknown) {
  return {
    playlistId: requiredString(body, "playlistId"),
  };
}

export function parseSoundCloudTrackRequest(body: unknown) {
  return {
    playlistId: requiredString(body, "playlistId"),
    trackId: requiredString(body, "trackId"),
  };
}
