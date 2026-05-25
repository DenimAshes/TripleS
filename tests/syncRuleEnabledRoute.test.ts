import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  syncRuleFindFirst: vi.fn(),
  syncRuleUpdate: vi.fn(),
  syncRuleCount: vi.fn(),
  playlistFindUnique: vi.fn(),
  playlistGroupMemberFindUnique: vi.fn(),
  playlistGroupMemberFindMany: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    syncRule: {
      findFirst: mocks.syncRuleFindFirst,
      update: mocks.syncRuleUpdate,
      count: mocks.syncRuleCount,
    },
    playlist: {
      findUnique: mocks.playlistFindUnique,
    },
    playlistGroupMember: {
      findUnique: mocks.playlistGroupMemberFindUnique,
      findMany: mocks.playlistGroupMemberFindMany,
    },
  },
}));

import { PATCH } from "../app/api/sync-rules/[id]/enabled/route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/sync-rules/rule-1/enabled", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "rule-1" }) };

describe("/api/sync-rules/[id]/enabled", () => {
  beforeEach(() => {
    mocks.requireAuth.mockReset();
    mocks.syncRuleFindFirst.mockReset();
    mocks.syncRuleUpdate.mockReset();
    mocks.syncRuleCount.mockReset();
    mocks.playlistFindUnique.mockReset();
    mocks.playlistGroupMemberFindUnique.mockReset();
    mocks.playlistGroupMemberFindMany.mockReset();

    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.syncRuleFindFirst.mockResolvedValue({
      id: "rule-1",
      userId: "user-1",
      sourceService: "SPOTIFY",
      sourcePlaylistId: "sp-1",
      direction: "TWO_WAY",
      nextRunAt: new Date("2026-05-15T00:00:00.000Z"),
    });
    mocks.playlistFindUnique.mockResolvedValue({ id: "playlist-1" });
    mocks.playlistGroupMemberFindUnique.mockResolvedValue({ groupId: "group-1" });
    mocks.playlistGroupMemberFindMany.mockResolvedValue([
      { playlist: { service: "SPOTIFY", servicePlaylistId: "sp-1" } },
      { playlist: { service: "YOUTUBE", servicePlaylistId: "yt-1" } },
    ]);
    mocks.syncRuleCount.mockResolvedValue(2);
    mocks.syncRuleUpdate.mockResolvedValue({ id: "rule-1", isEnabled: false, destinations: [] });
  });

  test("updates source monitoring state", async () => {
    const response = await PATCH(request({ enabled: false }), context);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.rule).toMatchObject({ id: "rule-1", isEnabled: false });
    expect(mocks.syncRuleUpdate).toHaveBeenCalledWith({
      where: { id: "rule-1" },
      data: {
        isEnabled: false,
        nextRunAt: new Date("2026-05-15T00:00:00.000Z"),
      },
      include: { destinations: true },
    });
  });

  test("rejects disabling the last active source in a group", async () => {
    mocks.syncRuleCount.mockResolvedValue(1);

    const response = await PATCH(request({ enabled: false }), context);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: "Keep at least one source platform enabled." });
    expect(mocks.syncRuleUpdate).not.toHaveBeenCalled();
  });

  test("rejects invalid enabled payload", async () => {
    const response = await PATCH(request({ enabled: "yes" }), context);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "enabled must be a boolean" });
    expect(mocks.syncRuleFindFirst).not.toHaveBeenCalled();
  });
});
