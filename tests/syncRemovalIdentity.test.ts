import { describe, expect, it } from "vitest";
import { removableDestinationTracks } from "@/lib/sync/syncEngine";
import type { NormalizedTrack } from "@/lib/sync/syncTypes";

describe("ADD_AND_REMOVE destination identity", () => {
  it("keeps a cross-service match whose provider id differs from the source id", () => {
    const destinationTrack: NormalizedTrack = {
      title: "Song",
      artists: ["Artist"],
      sourceService: "soundcloud",
      sourceTrackId: "soundcloud-track-id",
    };
    const serviceTracks = new Map([
      ["soundcloud::soundcloud-track-id", { id: "canonical-destination-id" }],
    ]);

    expect(removableDestinationTracks(
      [destinationTrack],
      "soundcloud",
      serviceTracks,
      new Set(["canonical-destination-id"]),
    )).toEqual([]);
  });

  it("returns only destination tracks absent from the desired canonical set", () => {
    const destinationTrack: NormalizedTrack = {
      title: "Old Song",
      artists: ["Artist"],
      sourceService: "soundcloud",
      sourceTrackId: "old-id",
    };

    expect(removableDestinationTracks(
      [destinationTrack],
      "soundcloud",
      new Map([["soundcloud::old-id", { id: "old-canonical-id" }]]),
      new Set(),
    )).toEqual([destinationTrack]);
  });
});
