import { describe, expect, it } from "vitest";
import { youtubePlaylistDeleteBlocker } from "../lib/services/youtube/youtubePlaylistDelete";

describe("YouTube playlist deletion", () => {
  it("blocks connected playlists and allows unused playlists", () => {
    expect(youtubePlaylistDeleteBlocker({ groupMemberships: 1, sourceRules: 0, destinationRules: 0 })).toContain(
      "Disconnect",
    );
    expect(youtubePlaylistDeleteBlocker({ groupMemberships: 0, sourceRules: 1, destinationRules: 0 })).toContain(
      "sync rules",
    );
    expect(youtubePlaylistDeleteBlocker({ groupMemberships: 0, sourceRules: 0, destinationRules: 1 })).toContain(
      "sync rules",
    );
    expect(youtubePlaylistDeleteBlocker({ groupMemberships: 0, sourceRules: 0, destinationRules: 0 })).toBeNull();
  });
});
