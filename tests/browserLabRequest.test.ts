import { describe, expect, test } from "vitest";
import {
  BrowserLabRequestError,
  parsePlaylistRefreshRequest,
  parseSoundCloudTrackRequest,
  parseYouTubeAddRequest,
  parseYouTubeRemoveRequest,
} from "../lib/services/browserLabRequest";

describe("browser lab request parsing", () => {
  test("trims valid request fields", () => {
    expect(parseYouTubeAddRequest({ playlistId: " p ", query: " artist - title " })).toEqual({
      playlistId: "p",
      query: "artist - title",
    });
    expect(parseYouTubeRemoveRequest({ playlistId: "p", trackText: " song " })).toEqual({
      playlistId: "p",
      trackText: "song",
    });
    expect(parseSoundCloudTrackRequest({ playlistId: "p", trackId: " t " })).toEqual({
      playlistId: "p",
      trackId: "t",
    });
    expect(parsePlaylistRefreshRequest({ playlistId: " p " })).toEqual({ playlistId: "p" });
  });

  test("rejects missing and overlong fields", () => {
    expect(() => parseYouTubeAddRequest({ playlistId: "", query: "x" })).toThrow(BrowserLabRequestError);
    expect(() => parseYouTubeAddRequest({ playlistId: "p", query: "" })).toThrow(BrowserLabRequestError);
    expect(() => parseSoundCloudTrackRequest({ playlistId: "p", trackId: "x".repeat(2001) })).toThrow(
      BrowserLabRequestError,
    );
  });
});
