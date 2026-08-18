import { describe, expect, it } from "vitest";
import {
  parsePlaylistRef,
  playlistPathsMatch,
  playlistRefsMatch,
  soundCloudPathFromUrl,
} from "../worker/runners/soundcloudPlaylistMatch";

describe("soundCloudPathFromUrl", () => {
  it("returns the trimmed pathname", () => {
    expect(soundCloudPathFromUrl("https://soundcloud.com/user/sets/slug/s-token")).toBe("user/sets/slug/s-token");
  });

  it("returns undefined for non-URLs", () => {
    expect(soundCloudPathFromUrl("user/sets/slug")).toBeUndefined();
    expect(soundCloudPathFromUrl(undefined)).toBeUndefined();
  });
});

describe("parsePlaylistRef", () => {
  it("splits a private set id into user, slug and secret", () => {
    expect(parsePlaylistRef("drdyue/sets/testovyj/s-XMcU2mLbWaP")).toEqual({
      user: "drdyue",
      slug: "testovyj",
      secret: "XMcU2mLbWaP",
    });
  });

  it("handles a public set without a secret", () => {
    expect(parsePlaylistRef("https://soundcloud.com/lightblesss/sets/na-fontane")).toEqual({
      user: "lightblesss",
      slug: "na-fontane",
      secret: undefined,
    });
  });

  it("returns just the user when the path is not a set", () => {
    expect(parsePlaylistRef("lightblesss/likes")).toEqual({ user: "lightblesss" });
  });

  it("returns nothing usable for empty input", () => {
    expect(parsePlaylistRef(undefined)).toEqual({});
    expect(parsePlaylistRef("")).toEqual({});
  });
});

describe("playlistRefsMatch", () => {
  it("matches the same playlist across an account rename", () => {
    expect(
      playlistRefsMatch(parsePlaylistRef("drdyue/sets/testovyj/s-XMcU2mLbWaP"), parsePlaylistRef("lightblesss/sets/testovyj/s-XMcU2mLbWaP")),
    ).toBe(true);
  });

  it("matches when only one side carries the secret token", () => {
    expect(playlistRefsMatch(parsePlaylistRef("drdyue/sets/testovyj/s-XMcU2mLbWaP"), parsePlaylistRef("lightblesss/sets/testovyj"))).toBe(true);
  });

  it("refuses two same-slug sets with different secrets", () => {
    expect(playlistRefsMatch(parsePlaylistRef("a/sets/mix/s-one"), parsePlaylistRef("b/sets/mix/s-two"))).toBe(false);
  });

  it("refuses different slugs and refs without a slug", () => {
    expect(playlistRefsMatch(parsePlaylistRef("a/sets/mix"), parsePlaylistRef("a/sets/other"))).toBe(false);
    expect(playlistRefsMatch(parsePlaylistRef("a/likes"), parsePlaylistRef("a/sets/mix"))).toBe(false);
  });
});

describe("playlistPathsMatch", () => {
  it("compares a stored id against a candidate permalink URL", () => {
    expect(playlistPathsMatch("drdyue/sets/snimite-toner/s-sKi1gkdT1a9", "https://soundcloud.com/lightblesss/sets/snimite-toner")).toBe(true);
    expect(playlistPathsMatch("drdyue/sets/snimite-toner/s-sKi1gkdT1a9", "https://soundcloud.com/lightblesss/sets/na-fontane")).toBe(false);
  });

  it("is false when either side is missing", () => {
    expect(playlistPathsMatch(undefined, "https://soundcloud.com/user/sets/slug")).toBe(false);
    expect(playlistPathsMatch("user/sets/slug", undefined)).toBe(false);
  });
});
