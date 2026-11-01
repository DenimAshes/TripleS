import { describe, expect, it } from "vitest";
import { findYouTubePlaylistByName, normalizeYouTubePlaylistName } from "../lib/services/youtube/youtubePlaylistName";

describe("YouTube playlist names", () => {
  it("matches duplicate names across casing, spacing, and Unicode width", () => {
    expect(normalizeYouTubePlaylistName("  Ｍｉｒｒｏｒ   Mix ")).toBe("mirror mix");
    expect(findYouTubePlaylistByName([{ id: "one", name: "Mirror Mix" }], " mirror   MIX ")?.id).toBe("one");
  });

  it("does not collapse distinct names", () => {
    expect(findYouTubePlaylistByName([{ id: "one", name: "Mirror Mix" }], "Mirror Mix 2")).toBeUndefined();
  });
});
