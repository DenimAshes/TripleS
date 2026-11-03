import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));

import { createSessionToken, requireAuth } from "@/lib/auth/session";

describe("session authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects weak JWT secrets in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "dev-secret");

    await expect(createSessionToken({ userId: "u", email: "a@example.com", name: "A" }))
      .rejects.toThrow("JWT_SECRET must be a unique value of at least 32 characters");
  });

  it("rejects a valid token after its user has been deleted", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_SECRET", "test-secret");
    mocks.findUnique.mockResolvedValue(null);
    const token = await createSessionToken({ userId: "deleted", email: "a@example.com", name: "A" });

    await expect(requireAuth(new Request("http://localhost/api/test", {
      headers: { Cookie: `triples_session=${token}` },
    }))).rejects.toThrow("UNAUTHORIZED");
  });
});
