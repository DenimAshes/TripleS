import { describe, expect, it } from "vitest";
import { normalizeArtist, normalizeTitle } from "../lib/utils/normalizeTrack";

describe("track normalization", () => {
  it("removes common video and release decorations from titles", () => {
    expect(normalizeTitle("Blinding Lights (Official Video) [4K]")).toBe("blinding lights");
    expect(normalizeTitle("Save Your Tears (Live)")).toBe("save your tears");
    expect(normalizeTitle("Flowers (Lyrics)")).toBe("flowers");
  });

  it("normalizes artist names for matching", () => {
    expect(normalizeArtist("The Weeknd")).toBe("weeknd");
    expect(normalizeArtist("Dua-Lipa")).toBe("dua lipa");
    expect(normalizeArtist("  THE Cure  ")).toBe("cure");
  });
});
