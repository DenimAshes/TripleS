import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password byte limits", () => {
  it("rejects passwords bcrypt would silently truncate", async () => {
    const overlong = "a".repeat(72) + "b";
    await expect(hashPassword(overlong)).rejects.toThrow("at most 72 UTF-8 bytes");
    await expect(verifyPassword(overlong, "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"))
      .resolves.toBe(false);
  });

  it("counts UTF-8 bytes rather than JavaScript characters", async () => {
    await expect(hashPassword("😀".repeat(19))).rejects.toThrow("at most 72 UTF-8 bytes");
  });
});
