import { describe, expect, test } from "vitest";
import {
  normalizePlaylistGroupSettings,
  PlaylistGroupSettingsError,
} from "@/lib/services/playlistGroupSettings";

describe("playlist group settings", () => {
  test("normalizes editable group settings", () => {
    expect(
      normalizePlaylistGroupSettings({
        name: "  Daily mix  ",
        mode: "add_and_remove",
        intervalMinutes: "30",
      }),
    ).toEqual({ name: "Daily mix", mode: "ADD_AND_REMOVE", intervalMinutes: 30 });
  });

  test.each([
    [{ name: "", mode: "ADD_ONLY", intervalMinutes: 60 }, "Name this sync group."],
    [{ name: "Mix", mode: "DELETE_ALL", intervalMinutes: 60 }, "Choose a valid sync behavior."],
    [{ name: "Mix", mode: "ADD_ONLY", intervalMinutes: 0 }, "Check frequency must be between 1 and 1440 minutes."],
  ])("rejects invalid settings", (input, message) => {
    expect(() => normalizePlaylistGroupSettings(input)).toThrowError(
      expect.objectContaining<Partial<PlaylistGroupSettingsError>>({ message }),
    );
  });
});
