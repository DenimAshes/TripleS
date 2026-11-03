import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/services/browserRunnerCli", () => ({ runBrowserRunnerCli: mocks.run }));

import { addFirstSearchResultToPlaylistCli } from "@/lib/services/youtube/youtubeBrowserCli";

describe("YouTube browser CLI add result", () => {
  it("returns the worker's structured duplicate result instead of assuming success", async () => {
    mocks.run
      .mockResolvedValueOnce(JSON.stringify([{
        title: "Song",
        artists: ["Artist"],
        sourceService: "youtube",
        sourceTrackId: "candidate",
      }]))
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce('[yt:add] Already in playlist: query { text }\n{"added":false}');

    await expect(addFirstSearchResultToPlaylistCli("playlist", "Artist Song"))
      .resolves.toEqual({ added: false });
  });
});
