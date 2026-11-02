import { describe, expect, it } from "vitest";
import { exactPlaylistOptionIndexes } from "../worker/runners/youtube";

describe("YouTube playlist dialog", () => {
  it("matches complete option titles instead of duplicate nested text nodes", () => {
    expect(exactPlaylistOptionIndexes(["Test", "Test extended"], "Test")).toEqual([0]);
    expect(exactPlaylistOptionIndexes(["Test", "Test"], "Test")).toEqual([0, 1]);
  });
});
