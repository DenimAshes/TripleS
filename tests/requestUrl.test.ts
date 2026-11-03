import { afterEach, describe, expect, it, vi } from "vitest";
import { sameOriginUrl } from "@/lib/utils/requestUrl";

describe("sameOriginUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does not trust a forged Host header", () => {
    vi.stubEnv("APP_URL", "");
    const request = new Request("https://safe.example/api/auth/login", {
      headers: { Host: "evil.example", "X-Forwarded-Proto": "https" },
    });

    expect(sameOriginUrl(request, "/dashboard").toString()).toBe("https://safe.example/dashboard");
  });

  it("uses the configured public app origin when present", () => {
    vi.stubEnv("APP_URL", "https://app.example/base/path");

    expect(sameOriginUrl(new Request("http://internal:3000/login"), "/dashboard").toString())
      .toBe("https://app.example/dashboard");
  });

  it("preserves a loopback host and port for local auth cookies", () => {
    vi.stubEnv("APP_URL", "");
    const request = new Request("http://localhost:3010/api/auth/login", {
      headers: { Host: "127.0.0.1:3010" },
    });

    expect(sameOriginUrl(request, "/dashboard").toString()).toBe("http://127.0.0.1:3010/dashboard");
  });

  it("fails clearly when APP_URL is malformed", () => {
    vi.stubEnv("APP_URL", "not a URL");
    expect(() => sameOriginUrl(new Request("http://localhost/login"), "/dashboard"))
      .toThrow("APP_URL must be a valid absolute URL.");
  });
});
