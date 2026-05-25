import { describe, expect, test } from "vitest";
import { parseTrackUrl, serviceFromTrackUrl, trackIdFromUrl } from "../lib/services/trackUrl";

describe("trackUrl helpers", () => {
  test("detects supported services from hosts", () => {
    expect(serviceFromTrackUrl(new URL("https://open.spotify.com/track/abc"))).toBe("SPOTIFY");
    expect(serviceFromTrackUrl(new URL("https://music.youtube.com/watch?v=yt1"))).toBe("YOUTUBE");
    expect(serviceFromTrackUrl(new URL("https://youtu.be/yt2"))).toBe("YOUTUBE");
    expect(serviceFromTrackUrl(new URL("https://soundcloud.com/a/b"))).toBe("SOUNDCLOUD");
  });

  test("extracts track ids per service", () => {
    expect(trackIdFromUrl(new URL("https://open.spotify.com/track/abc?si=1"), "SPOTIFY")).toBe("abc");
    expect(trackIdFromUrl(new URL("https://music.youtube.com/watch?v=yt1"), "YOUTUBE")).toBe("yt1");
    expect(trackIdFromUrl(new URL("https://soundcloud.com/artist/song"), "SOUNDCLOUD")).toBe("artist/song");
  });

  test("rejects unsupported or mismatched links", () => {
    expect(() => parseTrackUrl("ftp://open.spotify.com/track/abc")).toThrow(/http/);
    expect(() => parseTrackUrl("https://example.com/song")).toThrow(/unsupported/);
    expect(() => parseTrackUrl("https://soundcloud.com/a/b", "SPOTIFY")).toThrow(/SPOTIFY/);
  });
});
