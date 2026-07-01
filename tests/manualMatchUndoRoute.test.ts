import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  manualMatchCandidateFindFirst: vi.fn(),
  serviceTrackFindUnique: vi.fn(),
  transaction: vi.fn(),
  txManualMatchCandidateUpdate: vi.fn(),
  txTrackMatchDeleteMany: vi.fn(),
  txTrackMatchNegativeCacheDeleteMany: vi.fn(),
  txSyncTrackExclusionDeleteMany: vi.fn(),
  findCandidateGroup: vi.fn(),
  scheduleManualMatchFollowupSync: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    manualMatchCandidate: {
      findFirst: mocks.manualMatchCandidateFindFirst,
    },
    serviceTrack: {
      findUnique: mocks.serviceTrackFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/sync/manualMatchGroup", () => ({
  findCandidateGroup: mocks.findCandidateGroup,
}));

vi.mock("@/lib/services/manualMatchResolution", () => ({
  scheduleManualMatchFollowupSync: mocks.scheduleManualMatchFollowupSync,
}));

import { POST } from "../app/api/manual-match/[id]/undo/route";

function request(): Request {
  return new Request("http://localhost/api/manual-match/candidate-1/undo", { method: "POST" });
}

describe("manual match undo route", () => {
  beforeEach(() => {
    mocks.requireAuth.mockReset();
    mocks.manualMatchCandidateFindFirst.mockReset();
    mocks.serviceTrackFindUnique.mockReset();
    mocks.transaction.mockReset();
    mocks.txManualMatchCandidateUpdate.mockReset();
    mocks.txTrackMatchDeleteMany.mockReset();
    mocks.txTrackMatchNegativeCacheDeleteMany.mockReset();
    mocks.txSyncTrackExclusionDeleteMany.mockReset();
    mocks.findCandidateGroup.mockReset();
    mocks.scheduleManualMatchFollowupSync.mockReset();

    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.serviceTrackFindUnique.mockResolvedValue({ id: "source-track", internalTrackId: "internal-1" });
    mocks.scheduleManualMatchFollowupSync.mockResolvedValue({ count: 2 });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        manualMatchCandidate: { update: mocks.txManualMatchCandidateUpdate },
        trackMatch: { deleteMany: mocks.txTrackMatchDeleteMany },
        trackMatchNegativeCache: { deleteMany: mocks.txTrackMatchNegativeCacheDeleteMany },
        syncTrackExclusion: { deleteMany: mocks.txSyncTrackExclusionDeleteMany },
      }),
    );
    mocks.txTrackMatchDeleteMany.mockResolvedValue({ count: 1 });
    mocks.txTrackMatchNegativeCacheDeleteMany.mockResolvedValue({ count: 1 });
    mocks.txSyncTrackExclusionDeleteMany.mockResolvedValue({ count: 1 });
  });

  test("restores an accepted candidate and removes the confirmed target match", async () => {
    mocks.manualMatchCandidateFindFirst.mockResolvedValue({
      id: "candidate-1",
      userId: "user-1",
      status: "ACCEPTED",
      sourceServiceTrackId: "source-track",
      candidateServiceTrackId: "target-track",
      targetService: "YOUTUBE",
    });

    const response = await POST(request(), { params: Promise.resolve({ id: "candidate-1" }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.txManualMatchCandidateUpdate).toHaveBeenCalledWith({
      where: { id: "candidate-1" },
      data: { status: "PENDING" },
    });
    expect(mocks.txTrackMatchDeleteMany).toHaveBeenCalledWith({
      where: {
        internalTrackId: "internal-1",
        youtubeServiceTrackId: "target-track",
        status: "CONFIRMED",
      },
    });
    expect(mocks.txTrackMatchNegativeCacheDeleteMany).not.toHaveBeenCalled();
    expect(mocks.scheduleManualMatchFollowupSync).toHaveBeenCalledWith({
      userId: "user-1",
      sourceServiceTrackId: "source-track",
    });
    expect(payload).toEqual({
      ok: true,
      scheduledRules: 2,
      restoredStatus: "PENDING",
      deletedTrackMatches: 1,
      deletedNegativeCaches: 0,
      deletedExclusions: 0,
    });
  });

  test("restores a rejected candidate and clears skip/exclusion side effects", async () => {
    mocks.manualMatchCandidateFindFirst.mockResolvedValue({
      id: "candidate-1",
      userId: "user-1",
      status: "REJECTED",
      sourceServiceTrackId: "source-track",
      candidateServiceTrackId: "target-track",
      targetService: "SOUNDCLOUD",
    });
    mocks.findCandidateGroup.mockResolvedValue({ id: "group-1" });

    const response = await POST(request(), { params: Promise.resolve({ id: "candidate-1" }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.txManualMatchCandidateUpdate).toHaveBeenCalledWith({
      where: { id: "candidate-1" },
      data: { status: "PENDING" },
    });
    expect(mocks.txTrackMatchNegativeCacheDeleteMany).toHaveBeenCalledWith({
      where: {
        internalTrackId: "internal-1",
        targetService: "SOUNDCLOUD",
      },
    });
    expect(mocks.txSyncTrackExclusionDeleteMany).toHaveBeenCalledWith({
      where: {
        groupId: "group-1",
        sourceTrackId: "source-track",
        targetService: "SOUNDCLOUD",
        reason: "USER_CHOICE",
      },
    });
    expect(payload.deletedNegativeCaches).toBe(1);
    expect(payload.deletedExclusions).toBe(1);
  });

  test("does not undo a candidate that is already pending", async () => {
    mocks.manualMatchCandidateFindFirst.mockResolvedValue({
      id: "candidate-1",
      userId: "user-1",
      status: "PENDING",
      sourceServiceTrackId: "source-track",
      candidateServiceTrackId: "target-track",
      targetService: "YOUTUBE",
    });

    const response = await POST(request(), { params: Promise.resolve({ id: "candidate-1" }) });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe("This song is already waiting for review.");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
