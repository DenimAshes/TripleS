import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  playlistGroupFindFirst: vi.fn(),
  syncRuleFindMany: vi.fn(),
  transaction: vi.fn(),
  txPlaylistGroupUpdate: vi.fn(),
  txSyncRuleUpdate: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    playlistGroup: { findFirst: mocks.playlistGroupFindFirst },
    syncRule: { findMany: mocks.syncRuleFindMany },
    $transaction: mocks.transaction,
  },
}));

import { PATCH } from "../app/api/playlist-groups/[groupId]/route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/playlist-groups/group-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ groupId: "group-1" }) };

describe("/api/playlist-groups/[groupId]", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();

    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.playlistGroupFindFirst.mockResolvedValue({
      id: "group-1",
      members: [
        { playlist: { service: "SPOTIFY", servicePlaylistId: "sp-1", name: "Mix Spotify" } },
        { playlist: { service: "YOUTUBE", servicePlaylistId: "yt-1", name: "Mix YouTube" } },
      ],
    });
    mocks.syncRuleFindMany.mockResolvedValue([
      {
        id: "rule-spotify",
        sourceService: "SPOTIFY",
        sourcePlaylistId: "sp-1",
        direction: "TWO_WAY",
        isEnabled: true,
        destinations: [{ service: "YOUTUBE", playlistId: "yt-1" }],
      },
      {
        id: "rule-youtube",
        sourceService: "YOUTUBE",
        sourcePlaylistId: "yt-1",
        direction: "ONE_WAY",
        isEnabled: false,
        destinations: [{ service: "SPOTIFY", playlistId: "sp-1" }],
      },
      {
        id: "rule-outside-group",
        sourceService: "SPOTIFY",
        sourcePlaylistId: "sp-1",
        direction: "ONE_WAY",
        isEnabled: true,
        destinations: [{ service: "SOUNDCLOUD", playlistId: "sc-1" }],
      },
    ]);
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        playlistGroup: { update: mocks.txPlaylistGroupUpdate },
        syncRule: { update: mocks.txSyncRuleUpdate },
      }),
    );
  });

  test("updates the group and only its source rules", async () => {
    const response = await PATCH(
      request({ name: "  New Mix  ", mode: "ADD_AND_REMOVE", intervalMinutes: 30 }),
      context,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, updatedRules: 2, queuedSources: 1 });
    expect(mocks.txPlaylistGroupUpdate).toHaveBeenCalledWith({
      where: { id: "group-1" },
      data: { name: "New Mix" },
    });
    expect(mocks.txSyncRuleUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.txSyncRuleUpdate).toHaveBeenCalledWith({
      where: { id: "rule-spotify" },
      data: {
        name: "New Mix - Mix Spotify",
        mode: "ADD_AND_REMOVE",
        direction: "TWO_WAY",
        intervalMinutes: 30,
        nextRunAt: null,
        queuedReason: "rule_updated",
        queuedAt: expect.any(Date),
      },
    });
    expect(mocks.txSyncRuleUpdate).toHaveBeenCalledWith({
      where: { id: "rule-youtube" },
      data: {
        name: "New Mix - Mix YouTube",
        mode: "ADD_AND_REMOVE",
        direction: "TWO_WAY",
        intervalMinutes: 30,
      },
    });
  });

  test("does not expose another user's group", async () => {
    mocks.playlistGroupFindFirst.mockResolvedValue(null);

    const response = await PATCH(request({ name: "Mix", mode: "ADD_ONLY", intervalMinutes: 60 }), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Sync group not found." });
    expect(mocks.syncRuleFindMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
