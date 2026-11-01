import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workerSessionState: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      deleteMany: mocks.deleteMany,
    },
  },
}));

import { PUT } from "../app/api/admin/sessions/[service]/route";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/sessions/youtube", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("browser session upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ email: "admin@example.com" });
  });

  it("rejects the removed Spotify JSON session path", async () => {
    const response = await PUT(request({ cookies: [{ name: "sp_dc", value: "x" }] }), {
      params: Promise.resolve({ service: "spotify" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects browser exports without a usable authentication cookie", async () => {
    const response = await PUT(request({ cookies: [{ name: "PREF", value: "x" }] }), {
      params: Promise.resolve({ service: "youtube" }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "MISSING_AUTH_COOKIES" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("stores a valid browser session", async () => {
    mocks.upsert.mockImplementation(async ({ create }: { create: { bytes: number } }) => ({
      service: "youtube",
      bytes: create.bytes,
      updatedAt: new Date(),
      updatedBy: "admin@example.com",
    }));
    const response = await PUT(
      request({ cookies: [{ name: "SID", value: "valid", expires: Math.floor(Date.now() / 1000) + 3600 }] }),
      { params: Promise.resolve({ service: "youtube" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, isUsable: true });
  });
});
