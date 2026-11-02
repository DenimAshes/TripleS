import { describe, expect, it } from "vitest";
import { getEncryptionKeyError } from "../lib/crypto/tokenEncryption";

describe("token encryption config", () => {
  it("requires one 32-byte hexadecimal key", () => {
    expect(getEncryptionKeyError("")).toBe("ENCRYPTION_KEY is not configured.");
    expect(getEncryptionKeyError("not-hex")).toBe("ENCRYPTION_KEY must be exactly 64 hexadecimal characters.");
    expect(getEncryptionKeyError("a".repeat(64))).toBeNull();
  });
});
