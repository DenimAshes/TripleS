import { describe, expect, it } from "vitest";
import { __testables, trackPagePath } from "../worker/runners/soundcloudUiWrite";

const { labelMeansPresent } = __testables;

describe("trackPagePath", () => {
  it("reduces a permalink URL to its path", () => {
    expect(trackPagePath("https://soundcloud.com/theweeknd/blinding-lights")).toBe("theweeknd/blinding-lights");
  });

  it("drops query strings, fragments and trailing slashes", () => {
    expect(trackPagePath("https://soundcloud.com/artist/track/?in=user/sets/mix#t=30")).toBe("artist/track");
  });

  it("accepts a bare path", () => {
    expect(trackPagePath("artist/track")).toBe("artist/track");
    expect(trackPagePath("/artist/track/")).toBe("artist/track");
  });

  it("returns an empty string for a host without a path so callers can reject it", () => {
    expect(trackPagePath("https://soundcloud.com/")).toBe("");
  });
});

describe("labelMeansPresent", () => {
  it("treats the post-add labels as present", () => {
    expect(labelMeansPresent("Added")).toBe(true);
    expect(labelMeansPresent("Remove")).toBe(true);
    expect(labelMeansPresent("Remove from playlist")).toBe(true);
  });

  it("treats the add label as absent", () => {
    expect(labelMeansPresent("Add to playlist")).toBe(false);
  });

  it("does not treat unrelated labels as present", () => {
    expect(labelMeansPresent("Create playlist")).toBe(false);
    expect(labelMeansPresent("")).toBe(false);
  });
});
