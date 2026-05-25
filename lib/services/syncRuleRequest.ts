import { prisma } from "@/lib/db/prisma";

const SERVICES = new Set(["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"]);
const MODES = new Set(["ADD_ONLY", "ADD_AND_REMOVE", "FULL_MIRROR"]);

export class SyncRuleRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "SyncRuleRequestError";
  }
}

export type ValidSyncRuleDestination = {
  service: string;
  playlistId: string;
};

export type ValidSyncRuleInput = {
  name: string;
  sourceService: string;
  sourcePlaylistId: string;
  mode: string;
  intervalMinutes: number;
  isEnabled: boolean;
  destinations: ValidSyncRuleDestination[];
};

function normalizeService(value: unknown) {
  const service = String(value || "").trim().toUpperCase();
  if (!SERVICES.has(service)) {
    throw new SyncRuleRequestError(400, "Choose a valid source service.");
  }
  return service;
}

function parseInterval(value: unknown) {
  const interval = Number(value ?? 5);
  if (!Number.isInteger(interval) || interval < 1 || interval > 24 * 60) {
    throw new SyncRuleRequestError(400, "Sync interval must be between 1 and 1440 minutes.");
  }
  return interval;
}

function parseMode(value: unknown) {
  const mode = String(value || "ADD_ONLY").trim().toUpperCase();
  if (!MODES.has(mode)) {
    throw new SyncRuleRequestError(400, "Choose a valid sync mode.");
  }
  return mode;
}

function parseDestinations(value: unknown) {
  if (!Array.isArray(value)) {
    throw new SyncRuleRequestError(400, "Choose at least one destination playlist.");
  }

  const destinations: ValidSyncRuleDestination[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const service = normalizeService(raw.service);
    const playlistId = String(raw.playlistId || "").trim();
    if (!playlistId) continue;
    const key = `${service}:${playlistId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    destinations.push({ service, playlistId });
  }

  if (destinations.length === 0) {
    throw new SyncRuleRequestError(400, "Choose at least one destination playlist.");
  }
  return destinations;
}

export async function validateSyncRuleInput(userId: string, body: unknown): Promise<ValidSyncRuleInput> {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const sourceService = normalizeService(input.sourceService);
  const sourcePlaylistId = String(input.sourcePlaylistId || "").trim();
  if (!sourcePlaylistId) {
    throw new SyncRuleRequestError(400, "Choose a source playlist.");
  }

  const destinations = parseDestinations(input.destinations);
  if (destinations.some((destination) => destination.service === sourceService && destination.playlistId === sourcePlaylistId)) {
    throw new SyncRuleRequestError(400, "Source playlist cannot also be a destination.");
  }
  const intervalMinutes = parseInterval(input.intervalMinutes);

  const playlistKeys = [
    { service: sourceService, servicePlaylistId: sourcePlaylistId },
    ...destinations.map((destination) => ({ service: destination.service, servicePlaylistId: destination.playlistId })),
  ];
  const playlists = await prisma.playlist.findMany({
    where: {
      userId,
      OR: playlistKeys,
    },
  });
  const playlistByKey = new Map(playlists.map((playlist) => [`${playlist.service}:${playlist.servicePlaylistId}`, playlist]));
  const source = playlistByKey.get(`${sourceService}:${sourcePlaylistId}`);
  if (!source) {
    throw new SyncRuleRequestError(404, "Source playlist not found.");
  }

  for (const destination of destinations) {
    const playlist = playlistByKey.get(`${destination.service}:${destination.playlistId}`);
    if (!playlist) {
      throw new SyncRuleRequestError(404, "Destination playlist not found.");
    }
    if (!playlist.isWritable) {
      throw new SyncRuleRequestError(409, `${playlist.name} cannot be changed from this app.`);
    }
  }

  return {
    name: String(input.name || "Sync rule").trim() || "Sync rule",
    sourceService,
    sourcePlaylistId,
    mode: parseMode(input.mode),
    intervalMinutes,
    isEnabled: Boolean(input.isEnabled ?? true),
    destinations,
  };
}
