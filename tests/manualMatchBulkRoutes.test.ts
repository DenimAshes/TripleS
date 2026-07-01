import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  manualMatchCandidateFindMany: vi.fn(),
  manualMatchCandidateUpdate: vi.fn(),
  serviceTrackFindMany: vi.fn(),
  transaction: vi.fn(),
  upsertAutoTrackMatch: vi.fn(),
  closeCompetingManualCandidates: vi.fn(),
  scheduleManualMatchFollowupSyncs: vi.fn(),
  txManualMatchCandidateUpdate: vi.fn(),
  txTrackMatchDeleteMany: vi.fn(),
  txTrackMatchNegativeCacheUpsert: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    manualMatchCandidate: {
      findMany: mocks.manualMatchCandidateFindMany,
      update: mocks.manualMatchCandidateUpdate,
    },
    serviceTrack: {
      findMany: mocks.serviceTrackFindMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/sync/trackMatchStore", () => ({
  upsertAutoTrackMatch: mocks.upsertAutoTrackMatch,
}));

vi.mock("@/lib/services/manualMatchResolution", () => ({
  closeCompetingManualCandidates: mocks.closeCompetingManualCandidates,
  scheduleManualMatchFollowupSyncs: mocks.scheduleManualMatchFollowupSyncs,
}));

import { POST as acceptBulk } from "../app/api/manual-match/bulk-accept/route";
import { POST as rejectBulk } from "../app/api/manual-match/bulk-reject/route";

function request(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("manual match bulk routes", () => {
  beforeEach(() => {
    mocks.requireAuth.mockReset();
    mocks.manualMatchCandidateFindMany.mockReset();
    mocks.manualMatchCandidateUpdate.mockReset();
    mocks.serviceTrackFindMany.mockReset();
    mocks.transaction.mockReset();
    mocks.upsertAutoTrackMatch.mockReset();
    mocks.closeCompetingManualCandidates.mockReset();
    mocks.scheduleManualMatchFollowupSyncs.mockReset();
    mocks.txManualMatchCandidateUpdate.mockReset();
    mocks.txTrackMatchDeleteMany.mockReset();
    mocks.txTrackMatchNegativeCacheUpsert.mockReset();

    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.closeCompetingManualCandidates.mockResolvedValue({ count: 1 });
    mocks.scheduleManualMatchFollowupSyncs.mockResolvedValue({ count: 2 });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        manualMatchCandidate: { update: mocks.txManualMatchCandidateUpdate },
        trackMatch: { deleteMany: mocks.txTrackMatchDeleteMany },
        trackMatchNegativeCache: { upsert: mocks.txTrackMatchNegativeCacheUpsert },
      }),
    );
  });

  test("bulk accept confirms matches, closes competitors, and queues follow-up sync", async () => {
    mocks.manualMatchCandidateFindMany.mockResolvedValue([
      {
        id: "candidate-1",
        confidence: 0.92,
        sourceServiceTrackId: "source-track",
        candidateServiceTrackId: "target-track",
        targetService: "YOUTUBE",
        alternativesJson: null,
      },
    ]);
    mocks.serviceTrackFindMany.mockResolvedValue([
      { id: "source-track", service: "SPOTIFY", internalTrackId: "internal-1" },
      { id: "target-track", service: "YOUTUBE", internalTrackId: "internal-2" },
    ]);

    const response = await acceptBulk(request("http://localhost/api/manual-match/bulk-accept", { threshold: 0.9 }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.upsertAutoTrackMatch).toHaveBeenCalledWith({
      internalTrackId: "internal-1",
      sourceService: "SPOTIFY",
      destinationService: "YOUTUBE",
      sourceServiceTrackId: "source-track",
      targetServiceTrackId: "target-track",
      confidence: 0.92,
      status: "CONFIRMED",
    });
    expect(mocks.manualMatchCandidateUpdate).toHaveBeenCalledWith({
      where: { id: "candidate-1" },
      data: { status: "ACCEPTED", candidateServiceTrackId: "target-track", confidence: 0.92 },
    });
    expect(mocks.closeCompetingManualCandidates).toHaveBeenCalledWith({
      userId: "user-1",
      sourceServiceTrackId: "source-track",
      targetService: "YOUTUBE",
      keepId: "candidate-1",
    });
    expect(mocks.scheduleManualMatchFollowupSyncs).toHaveBeenCalledWith({
      userId: "user-1",
      sourceServiceTrackIds: ["source-track"],
    });
    expect(payload).toEqual({ threshold: 0.9, accepted: 1, failed: 0, scheduledRules: 2, errors: [] });
  });

  test("bulk accept preview includes readable source and target songs", async () => {
    mocks.manualMatchCandidateFindMany.mockResolvedValue([
      {
        id: "candidate-1",
        confidence: 0.92,
        sourceServiceTrackId: "source-track",
        candidateServiceTrackId: "target-track",
        targetService: "YOUTUBE",
      },
    ]);
    mocks.serviceTrackFindMany.mockResolvedValue([
      { id: "source-track", service: "SPOTIFY", title: "Source song", artistsJson: JSON.stringify(["Source Artist"]) },
      { id: "target-track", service: "YOUTUBE", title: "Target song", artistsJson: JSON.stringify(["Target Artist"]) },
    ]);

    const response = await acceptBulk(request("http://localhost/api/manual-match/bulk-accept", { threshold: 0.9, preview: true }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.serviceTrackFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["source-track", "target-track"] } },
      select: { id: true, service: true, title: true, artistsJson: true },
    });
    expect(payload).toEqual({
      threshold: 0.9,
      count: 1,
      remaining: 0,
      candidates: [
        {
          id: "candidate-1",
          confidence: 0.92,
          sourceServiceTrackId: "source-track",
          sourceService: "SPOTIFY",
          sourceTitle: "Source song",
          sourceArtists: ["Source Artist"],
          candidateServiceTrackId: "target-track",
          candidateService: "YOUTUBE",
          candidateTitle: "Target song",
          candidateArtists: ["Target Artist"],
          targetService: "YOUTUBE",
        },
      ],
    });
  });

  test("bulk reject writes negative cache and queues follow-up sync", async () => {
    mocks.manualMatchCandidateFindMany.mockResolvedValue([
      {
        id: "candidate-1",
        confidence: 0.4,
        sourceServiceTrackId: "source-track",
        candidateServiceTrackId: "target-track",
        targetService: "YOUTUBE",
      },
    ]);
    mocks.serviceTrackFindMany.mockResolvedValue([{ id: "source-track", internalTrackId: "internal-1" }]);

    const response = await rejectBulk(request("http://localhost/api/manual-match/bulk-reject", { threshold: 0.5 }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.txManualMatchCandidateUpdate).toHaveBeenCalledWith({
      where: { id: "candidate-1" },
      data: { status: "REJECTED" },
    });
    expect(mocks.txTrackMatchDeleteMany).toHaveBeenCalledWith({
      where: {
        internalTrackId: "internal-1",
        youtubeServiceTrackId: "target-track",
      },
    });
    expect(mocks.txTrackMatchNegativeCacheUpsert).toHaveBeenCalledWith({
      where: {
        internalTrackId_targetService: {
          internalTrackId: "internal-1",
          targetService: "YOUTUBE",
        },
      },
      update: { attemptedAt: expect.any(Date) },
      create: {
        internalTrackId: "internal-1",
        targetService: "YOUTUBE",
        attemptedAt: expect.any(Date),
      },
    });
    expect(mocks.scheduleManualMatchFollowupSyncs).toHaveBeenCalledWith({
      userId: "user-1",
      sourceServiceTrackIds: ["source-track"],
    });
    expect(payload).toEqual({ threshold: 0.5, rejected: 1, failed: 0, scheduledRules: 2, errors: [] });
  });

  test("bulk reject preview caps visible candidates and reports remaining count", async () => {
    mocks.manualMatchCandidateFindMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: `candidate-${index}`,
        confidence: 0.4,
        sourceServiceTrackId: `source-${index}`,
        candidateServiceTrackId: `target-${index}`,
        targetService: "SOUNDCLOUD",
      })),
    );
    mocks.serviceTrackFindMany.mockResolvedValue([]);

    const response = await rejectBulk(request("http://localhost/api/manual-match/bulk-reject", { threshold: 0.5, preview: true }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(10);
    expect(payload.remaining).toBe(2);
    expect(payload.candidates).toHaveLength(8);
  });
});
