import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdapter, serviceKey } from "@/lib/services/adapterFactory";
import { SoundCloudMockAdapter } from "@/lib/services/soundcloud/SoundCloudMockAdapter";

describe("adapterFactory", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does not pretend configured SoundCloud OAuth is implemented", () => {
    vi.stubEnv("SOUNDCLOUD_BROWSER_AUTOMATION", "false");
    vi.stubEnv("SOUNDCLOUD_CLIENT_ID", "configured-but-unsupported");

    expect(getAdapter(" SoundCloud ")).toBeInstanceOf(SoundCloudMockAdapter);
  });

  it("rejects unknown services instead of treating them as SoundCloud", () => {
    expect(() => getAdapter("unknown")).toThrow("Unsupported service: unknown");
    expect(() => serviceKey("unknown")).toThrow("Unsupported service: unknown");
  });
});
