import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  verifyPassword: vi.fn(),
  createSessionToken: vi.fn(async () => "session-token"),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/auth/password", () => ({ verifyPassword: mocks.verifyPassword }));
vi.mock("@/lib/auth/session", () => ({
  createSessionToken: mocks.createSessionToken,
  sessionCookieName: () => "triples_session",
}));

import { POST } from "@/app/api/auth/login/route";
import { POST as LOGOUT } from "@/app/api/auth/logout/route";

function loginRequest(ip: string, email = "admin@example.com") {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Forwarded-For": ip,
    },
    body: new URLSearchParams({ email, password: "secret" }),
  });
}

describe("login route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a dummy hash for unknown users", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.verifyPassword.mockResolvedValue(false);

    const response = await POST(loginRequest("203.0.113.10"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/login?error=invalid");
    expect(mocks.verifyPassword).toHaveBeenCalledWith("secret", expect.stringMatching(/^\$2b\$10\$/));
  });

  it("uses a 303 redirect after a successful form login", async () => {
    mocks.findFirst.mockResolvedValue({ id: "user-1", email: "admin@example.com", name: "Admin", passwordHash: "hash" });
    mocks.verifyPassword.mockResolvedValue(true);

    const response = await POST(loginRequest("203.0.113.11", " ADMIN@EXAMPLE.COM "));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(/\/dashboard$/);
    expect(response.headers.get("set-cookie")).toContain("triples_session=session-token");
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { email: { equals: "admin@example.com", mode: "insensitive" } } });
  });

  it("rate-limits repeated failed form logins by client IP", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.verifyPassword.mockResolvedValue(false);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await POST(loginRequest("203.0.113.12", "target@example.com"));
      expect(response.headers.get("location")).toContain("error=invalid");
    }
    const blocked = await POST(loginRequest("203.0.113.12", "target@example.com"));

    expect(blocked.status).toBe(303);
    expect(blocked.headers.get("location")).toContain("error=rate_limited");
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(10);
  });

  it("atomically limits concurrent attempts before password verification", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.verifyPassword.mockResolvedValue(false);

    const responses = await Promise.all(Array.from({ length: 11 }, () =>
      POST(loginRequest("203.0.113.13", "concurrent@example.com")),
    ));

    expect(responses.filter((response) => response.headers.get("location")?.includes("rate_limited"))).toHaveLength(1);
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(10);
  });

  it("uses a 303 redirect when signing out", async () => {
    const response = await LOGOUT(new Request("http://localhost/api/auth/logout", { method: "POST" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(/\/login$/);
    expect(response.headers.get("set-cookie")).toContain("triples_session=");
  });
});
