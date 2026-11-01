import { describe, expect, test } from "vitest";
import {
  BrowserLabRequestError,
  parsePlaylistRefreshRequest,
  parseSoundCloudTrackRequest,
  parseYouTubeAddRequest,
  parseYouTubeCreateRequest,
  parseYouTubeDeleteRequest,
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
    expect(parseYouTubeCreateRequest({ name: " New playlist " })).toEqual({ name: "New playlist" });
    expect(parseYouTubeDeleteRequest({ playlistId: " PL123 " })).toEqual({ playlistId: "PL123" });
  });

  test("rejects missing and overlong fields", () => {
    expect(() => parseYouTubeAddRequest({ playlistId: "", query: "x" })).toThrow(BrowserLabRequestError);
    expect(() => parseYouTubeAddRequest({ playlistId: "p", query: "" })).toThrow(BrowserLabRequestError);
    expect(() => parseSoundCloudTrackRequest({ playlistId: "p", trackId: "x".repeat(2001) })).toThrow(
      BrowserLabRequestError,
    );
    expect(() => parseYouTubeCreateRequest({ name: "x".repeat(151) })).toThrow(BrowserLabRequestError);
  });
});
