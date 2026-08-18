import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workerSessionState: {
      upsert: mocks.upsert,
    },
  },
}));

import {
  decodeStorageState,
  encodeStorageState,
  isSessionService,
  normalizeStorageState,
  sessionCookiesPresent,
  upsertWorkerSessionState,
} from "../lib/services/workerSessionState";

describe("normalizeStorageState", () => {
  test("keeps cookies and origins from a Playwright storage state", () => {
    const state = normalizeStorageState({
      cookies: [{ name: "SID", value: "abc", domain: ".youtube.com", path: "/", expires: 1780000000.7, secure: true }],
      origins: [{ origin: "https://music.youtube.com", localStorage: [] }],
    });
    expect(state).toEqual({
      cookies: [{ name: "SID", value: "abc", domain: ".youtube.com", path: "/", expires: 1780000000, secure: true }],
      origins: [{ origin: "https://music.youtube.com", localStorage: [] }],
    });
  });

  test("accepts a bare cookie array from a Cookie-Editor export", () => {
    const state = normalizeStorageState([
      { name: "LOGIN_INFO", value: "x", expirationDate: 1790000000.9, sameSite: "no_restriction" },
    ]);
    expect(state).toEqual({
      cookies: [{ name: "LOGIN_INFO", value: "x", expires: 1790000000, sameSite: "None" }],
      origins: [],
    });
  });

  test("normalizes sameSite spellings and drops unknown ones", () => {
    const state = normalizeStorageState([
      { name: "a", value: "1", sameSite: "lax" },
      { name: "b", value: "2", sameSite: "STRICT" },
      { name: "c", value: "3", sameSite: "whatever" },
    ]);
    expect(state?.cookies.map((cookie) => cookie.sameSite)).toEqual(["Lax", "Strict", undefined]);
  });

  test("skips entries without a name/value pair", () => {
    const state = normalizeStorageState([{ name: "keep", value: "1" }, { name: "drop" }, 42, null]);
    expect(state?.cookies).toEqual([{ name: "keep", value: "1" }]);
  });

  test("rejects payloads that carry no cookies", () => {
    expect(normalizeStorageState([])).toBeNull();
    expect(normalizeStorageState({ cookies: [] })).toBeNull();
    expect(normalizeStorageState({ cookies: [{ nope: true }] })).toBeNull();
    expect(normalizeStorageState("cookies")).toBeNull();
    expect(normalizeStorageState(null)).toBeNull();
  });
});

describe("encode/decode", () => {
  test("round-trips a normalized state through gzip+base64", () => {
    const state = { cookies: [{ name: "SID", value: "abc" }], origins: [] };
    const encoded = encodeStorageState(state);
    expect(encoded.bytes).toBe(Buffer.byteLength(JSON.stringify(state), "utf8"));
    expect(decodeStorageState(encoded.stateGzipBase64)).toEqual(state);
  });

  test("decodes values that carry surrounding whitespace", () => {
    const encoded = encodeStorageState({ cookies: [{ name: "SID", value: "abc" }], origins: [] });
    expect(decodeStorageState(`\n${encoded.stateGzipBase64}\n`)).toEqual({
      cookies: [{ name: "SID", value: "abc" }],
      origins: [],
    });
  });
});

describe("sessionCookiesPresent", () => {
  test("reports which known session cookies a state carries", () => {
    const state = {
      cookies: [{ name: "SID", value: "1" }, { name: "LOGIN_INFO", value: "2" }, { name: "PREF", value: "3" }],
      origins: [],
    };
    expect(sessionCookiesPresent("youtube", state)).toEqual(["SID", "LOGIN_INFO"]);
  });

  test("returns nothing for a state without the service session cookies", () => {
    expect(sessionCookiesPresent("youtube", { cookies: [{ name: "PREF", value: "1" }], origins: [] })).toEqual([]);
  });
});

describe("isSessionService", () => {
  test("accepts the three supported services only", () => {
    expect(isSessionService("youtube")).toBe(true);
    expect(isSessionService("soundcloud")).toBe(true);
    expect(isSessionService("spotify")).toBe(true);
    expect(isSessionService("tidal")).toBe(false);
  });
});

describe("upsertWorkerSessionState", () => {
  beforeEach(() => {
    mocks.upsert.mockReset();
  });

  test("stores the gzipped state and returns the stored summary", async () => {
    const updatedAt = new Date("2026-08-18T18:00:00.000Z");
    mocks.upsert.mockImplementation(async ({ create }: { create: { bytes: number } }) => ({
      service: "youtube",
      bytes: create.bytes,
      updatedAt,
      updatedBy: "state:push@host",
    }));

    const state = { cookies: [{ name: "SID", value: "abc" }, { name: "LOGIN_INFO", value: "d" }], origins: [] };
    const stored = await upsertWorkerSessionState({ service: "youtube", state, updatedBy: "state:push@host" });

    expect(stored).toEqual({
      service: "youtube",
      bytes: Buffer.byteLength(JSON.stringify(state), "utf8"),
      cookies: 2,
      updatedAt,
      updatedBy: "state:push@host",
    });

    const args = mocks.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ service: "youtube" });
    expect(decodeStorageState(args.create.stateGzipBase64)).toEqual(state);
    expect(decodeStorageState(args.update.stateGzipBase64)).toEqual(state);
    expect(args.update.updatedBy).toBe("state:push@host");
  });
});
