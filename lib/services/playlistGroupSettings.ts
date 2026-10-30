export class PlaylistGroupSettingsError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "PlaylistGroupSettingsError";
  }
}

export type PlaylistGroupSettings = {
  name: string;
  mode: "ADD_ONLY" | "ADD_AND_REMOVE";
  intervalMinutes: number;
};

export function normalizePlaylistGroupSettings(input: unknown): PlaylistGroupSettings {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const name = String(raw.name || "").trim().slice(0, 120);
  const mode = String(raw.mode || "ADD_ONLY").toUpperCase();
  const intervalMinutes = Number(raw.intervalMinutes ?? 60);

  if (!name) throw new PlaylistGroupSettingsError(400, "Name this sync group.");
  if (mode !== "ADD_ONLY" && mode !== "ADD_AND_REMOVE") {
    throw new PlaylistGroupSettingsError(400, "Choose a valid sync behavior.");
  }
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
    throw new PlaylistGroupSettingsError(400, "Check frequency must be between 1 and 1440 minutes.");
  }

  return { name, mode, intervalMinutes };
}
