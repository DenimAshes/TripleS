import { describe, expect, it } from "vitest";
import { isDuplicateYouTubeTrack } from "@/lib/services/youtube/youtubeDuplicate";
import type { NormalizedTrack } from "@/lib/sync/syncTypes";

function track(overrides: Partial<NormalizedTrack> = {}): NormalizedTrack {
  return {
    title: "Quiet Turn Up",
    artists: ["Kai Angel"],
    sourceService: "youtube",
    sourceTrackId: "video-1",
    ...overrides,
  };
}

describe("isDuplicateYouTubeTrack", () => {
  it("accepts strong identifiers regardless of metadata formatting", () => {
    expect(isDuplicateYouTubeTrack(track(), track({ title: "Different", artists: ["Other"] }))).toBe(true);
    expect(isDuplicateYouTubeTrack(
      track({ sourceTrackId: "a", isrc: "lv-abc-12" }),
      track({ sourceTrackId: "b", isrc: "LV-ABC-12" }),
    )).toBe(true);
  });

  it("matches the same normalized title only when the artist also matches", () => {
    expect(isDuplicateYouTubeTrack(
      track({ sourceTrackId: "a" }),
      track({ sourceTrackId: "b", title: "Quiet Turn Up (Official Audio)" }),
    )).toBe(true);
    expect(isDuplicateYouTubeTrack(
      track({ sourceTrackId: "a", title: "Intro", artists: ["Artist A"] }),
      track({ sourceTrackId: "b", title: "Intro", artists: ["Artist B"] }),
    )).toBe(false);
  });

  it("does not treat a generic title substring from another artist as a duplicate", () => {
    expect(isDuplicateYouTubeTrack(
      track({ sourceTrackId: "a", title: "Love Story", artists: ["Artist A"] }),
      track({ sourceTrackId: "b", title: "Love", artists: ["Artist B"] }),
      "Artist A Love Story",
    )).toBe(false);
  });

  it("uses an artist-and-title search query when provider artist metadata differs", () => {
    expect(isDuplicateYouTubeTrack(
      track({ sourceTrackId: "a", artists: ["Official Channel"] }),
      track({ sourceTrackId: "b" }),
      "Kai Angel Quiet Turn Up",
    )).toBe(true);
  });
});
