import { describe, expect, it } from "vitest";
import {
  extractFeaturedArtists,
  extractVariantTag,
  inferArtistTitleFromDecoratedTitle,
  normalizeArtist,
  normalizedArtistSet,
  normalizeTitle,
  splitArtists,
  stripLeadingArtist,
} from "../lib/utils/normalizeTrack";

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

  it("strips repeated leading artists when they are known", () => {
    expect(stripLeadingArtist("Artist1 - Artist2 - Title", ["Artist1", "Artist2"])).toBe("Title");
  });

  it("infers YouTube-style artist and title when artists are missing or channel-like", () => {
    expect(inferArtistTitleFromDecoratedTitle({ title: "The Weeknd - Blinding Lights", artists: [] })).toEqual({
      artist: "The Weeknd",
      title: "Blinding Lights",
    });
    expect(inferArtistTitleFromDecoratedTitle({ title: "The Weeknd - Blinding Lights", artists: ["The Weeknd Topic"] })).toEqual({
      artist: "The Weeknd",
      title: "Blinding Lights",
    });
  });

  it("detects newer social-platform variant tags", () => {
    expect(extractVariantTag("Track - phonk remix")).toContain("phonk");
    expect(extractVariantTag("Track (8D Audio)")).toContain("8d");
    expect(extractVariantTag("Track - TikTok Edit")).toContain("tiktok");
    expect(extractVariantTag("Track - anti-nightcore")).toContain("nightcore");
  });

  it("extracts featured artists across locales", () => {
    expect(extractFeaturedArtists("Сосед (piedalās Гера Джио)")).toEqual(["Гера Джио"]);
    expect(extractFeaturedArtists("Track (feat. Artist A)")).toEqual(["Artist A"]);
    expect(extractFeaturedArtists("Track ft. Artist A & Artist B")).toEqual(["Artist A", "Artist B"]);
    expect(extractFeaturedArtists("Песня (при участии Иван Иванов)")).toEqual(["Иван Иванов"]);
    expect(extractFeaturedArtists("Песня (при уч. Петров)")).toEqual(["Петров"]);
    expect(extractFeaturedArtists("Track featuring Some One")).toEqual(["Some One"]);
    expect(extractFeaturedArtists("Plain title")).toEqual([]);
  });

  it("merges featured artists from title into the normalized artist set", () => {
    const set = normalizedArtistSet(["Каспийский Груз"], "Сосед (piedalās Гера Джио)");
    expect(set.has("каспийский груз")).toBe(true);
    expect(set.has("гера джио")).toBe(true);
  });

  it("splits collaborations joined by the Latvian \"un\"", () => {
    expect(splitArtists("Клава Кока un NILETTO")).toEqual(["Клава Кока", "NILETTO"]);
    const set = normalizedArtistSet(["Пошлая Молли un Элджей"]);
    expect(set.has("пошлая молли")).toBe(true);
    expect(set.has("элджей")).toBe(true);
  });

  it("keeps names that merely start with un intact", () => {
    expect(splitArtists("Sun Kil Moon")).toEqual(["Sun Kil Moon"]);
    expect(splitArtists("UNKLE")).toEqual(["UNKLE"]);
    expect(splitArtists("Untitled Group")).toEqual(["Untitled Group"]);
  });
});
