import { describe, expect, it } from "vitest";
import { getMissingSpotifyScopes } from "../lib/services/spotify/spotifyAuth";

describe("spotify scopes", () => {
  it("reports scopes that the connected account did not grant", () => {
    expect(getMissingSpotifyScopes(
      ["user-read-private", "playlist-read-private"],
      "user-read-private playlist-read-private playlist-modify-private",
    )).toEqual(["playlist-modify-private"]);
  });
});
