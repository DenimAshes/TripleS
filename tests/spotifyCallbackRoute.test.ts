import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  saveTokens: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(async () => ({ userId: "session-user", email: "admin@example.com" })),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/services/tokenStore", () => ({ saveConnectedAccountTokens: mocks.saveTokens }));
vi.mock("@/lib/services/playlistRefresh", () => ({ refreshServicePlaylists: vi.fn() }));

import { GET } from "@/app/api/oauth/spotify/callback/route";

describe("Spotify OAuth callback", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("does not attach tokens to a fallback admin when the session user is gone", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/oauth/spotify/callback?code=x&state=y"));

    expect(response.status).toBe(401);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: "session-user" } });
  });

  it("returns OAuth errors to Connections and clears the state cookie", async () => {
    mocks.findUnique.mockResolvedValue({ id: "session-user" });

    const response = await GET(new Request(
      "http://localhost/api/oauth/spotify/callback?error=access_denied&state=state",
      { headers: { Cookie: "spotify_oauth_state=state" } },
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/connections?spotify_error=Spotify%20login%20was%20cancelled.#connection-spotify");
    expect(response.headers.get("set-cookie")).toContain("spotify_oauth_state=");
  });

  it("rejects OAuth errors whose state does not match the cookie", async () => {
    mocks.findUnique.mockResolvedValue({ id: "session-user" });

    const response = await GET(new Request(
      "http://localhost/api/oauth/spotify/callback?error=access_denied&state=forged",
      { headers: { Cookie: "spotify_oauth_state=real" } },
    ));

    expect(response.headers.get("location")).toContain("Invalid%20or%20expired%20Spotify%20login%20state");
  });

  it("rejects malformed token responses before storing credentials", async () => {
    mocks.findUnique.mockResolvedValue({ id: "session-user" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: 42, expires_in: "soon" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await GET(new Request(
      "http://localhost/api/oauth/spotify/callback?code=code&state=state",
      { headers: { Cookie: "spotify_oauth_state=state" } },
    ));

    expect(response.headers.get("location")).toContain("Spotify%20returned%20an%20invalid%20token%20response");
    expect(mocks.saveTokens).not.toHaveBeenCalled();
  });

  it("does not store fallback identity when the Spotify profile request fails", async () => {
    mocks.findUnique.mockResolvedValue({ id: "session-user" });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response("provider unavailable", { status: 503 }));

    const response = await GET(new Request(
      "http://localhost/api/oauth/spotify/callback?code=code&state=state",
      { headers: { Cookie: "spotify_oauth_state=state" } },
    ));

    expect(response.headers.get("location")).toContain("provider%20unavailable");
    expect(mocks.saveTokens).not.toHaveBeenCalled();
  });
});
