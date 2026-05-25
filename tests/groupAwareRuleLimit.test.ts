import { describe, expect, test } from "vitest";
import {
  applyGroupAwareRuleLimit,
  buildSourcePlaylistGroupMap,
  ruleBatchKey,
} from "@/lib/sync/groupAwareRuleLimit";

describe("group-aware sync rule limit", () => {
  test("counts all source rules from the same playlist group as one batch", () => {
    const groupMap = buildSourcePlaylistGroupMap([
      { groupId: "group-1", playlist: { service: "SPOTIFY", servicePlaylistId: "sp-1" } },
      { groupId: "group-1", playlist: { service: "YOUTUBE", servicePlaylistId: "yt-1" } },
      { groupId: "group-1", playlist: { service: "SOUNDCLOUD", servicePlaylistId: "sc-1" } },
    ]);
    const rules = [
      { id: "rule-sp", sourceService: "SPOTIFY", sourcePlaylistId: "sp-1" },
      { id: "rule-yt", sourceService: "YOUTUBE", sourcePlaylistId: "yt-1" },
      { id: "rule-other", sourceService: "SPOTIFY", sourcePlaylistId: "sp-2" },
      { id: "rule-sc", sourceService: "SOUNDCLOUD", sourcePlaylistId: "sc-1" },
    ];

    const result = applyGroupAwareRuleLimit(rules, groupMap, 1);

    expect(result.selected.map((rule) => rule.id)).toEqual(["rule-sp", "rule-yt", "rule-sc"]);
    expect(result.skipped.map((rule) => rule.id)).toEqual(["rule-other"]);
  });

  test("keeps ungrouped rules independent", () => {
    const result = applyGroupAwareRuleLimit(
      [
        { id: "rule-1", sourceService: "SPOTIFY", sourcePlaylistId: "sp-1" },
        { id: "rule-2", sourceService: "SPOTIFY", sourcePlaylistId: "sp-2" },
      ],
      new Map(),
      1,
    );

    expect(result.selected.map((rule) => rule.id)).toEqual(["rule-1"]);
    expect(result.skipped.map((rule) => rule.id)).toEqual(["rule-2"]);
  });

  test("uses a stable group batch key for matched source playlists", () => {
    const groupMap = new Map([["SPOTIFY:sp-1", "group-1"]]);

    expect(ruleBatchKey({ id: "rule-1", sourceService: "spotify", sourcePlaylistId: "sp-1" }, groupMap)).toBe("group:group-1");
    expect(ruleBatchKey({ id: "rule-2", sourceService: "spotify", sourcePlaylistId: "sp-2" }, groupMap)).toBe("rule:rule-2");
  });
});
