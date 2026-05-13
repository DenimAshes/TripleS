import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deterministicSeed, extraStealthArgs, fingerprintSeed } from "../worker/browserSession";

const TRACKED_ENV = [
  "WORKER_FP_SEED",
  "WORKER_FP_SEED_YOUTUBE",
  "WORKER_FP_SEED_SPOTIFY",
  "WORKER_FP_SEED_SOUNDCLOUD",
  "WORKER_FP_PLATFORM",
  "WORKER_FP_NOISE",
  "WORKER_STORAGE_QUOTA_MB",
  "WORKER_WEBRTC_IP",
  "WORKER_DISABLE_HTTP2",
];

describe("browserSession env helpers", () => {
  let snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    snapshot = Object.fromEntries(TRACKED_ENV.map((k) => [k, process.env[k]]));
    for (const k of TRACKED_ENV) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("deterministicSeed is stable per service and within 5-digit range", () => {
    const a = deterministicSeed("youtube");
    const b = deterministicSeed("youtube");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(10000);
    expect(a).toBeLessThanOrEqual(99999);
  });

  it("deterministicSeed differs across services", () => {
    expect(deterministicSeed("youtube")).not.toBe(deterministicSeed("spotify"));
    expect(deterministicSeed("spotify")).not.toBe(deterministicSeed("soundcloud"));
  });

  it("fingerprintSeed prefers per-service env over global", () => {
    process.env.WORKER_FP_SEED = "11111";
    process.env.WORKER_FP_SEED_YOUTUBE = "22222";
    expect(fingerprintSeed("youtube")).toBe(22222);
    expect(fingerprintSeed("spotify")).toBe(11111);
  });

  it("fingerprintSeed falls back to deterministic when env is absent or invalid", () => {
    process.env.WORKER_FP_SEED = "not-a-number";
    expect(fingerprintSeed("youtube")).toBe(deterministicSeed("youtube"));
  });

  it("extraStealthArgs always includes --fingerprint", () => {
    const args = extraStealthArgs("youtube");
    expect(args.some((a) => a.startsWith("--fingerprint="))).toBe(true);
  });

  it("extraStealthArgs adds platform/quota/webrtc/noise/http2 when set", () => {
    process.env.WORKER_FP_PLATFORM = "windows";
    process.env.WORKER_STORAGE_QUOTA_MB = "5000";
    process.env.WORKER_WEBRTC_IP = "auto";
    process.env.WORKER_FP_NOISE = "false";
    process.env.WORKER_DISABLE_HTTP2 = "true";

    const args = extraStealthArgs("youtube");
    expect(args).toContain("--fingerprint-platform=windows");
    expect(args).toContain("--fingerprint-storage-quota=5000");
    expect(args).toContain("--fingerprint-webrtc-ip=auto");
    expect(args).toContain("--fingerprint-noise=false");
    expect(args).toContain("--disable-http2");
  });

  it("extraStealthArgs omits optional flags by default", () => {
    const args = extraStealthArgs("spotify");
    expect(args.some((a) => a.startsWith("--fingerprint-platform"))).toBe(false);
    expect(args.some((a) => a.startsWith("--fingerprint-storage-quota"))).toBe(false);
    expect(args.some((a) => a.startsWith("--fingerprint-webrtc-ip"))).toBe(false);
    expect(args.some((a) => a === "--disable-http2")).toBe(false);
  });
});
