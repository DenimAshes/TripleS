import crypto from "crypto";

const DEFAULT_KEY = "0000000000000000000000000000000000000000000000000000000000000000";

function getKey() {
  const hex = process.env.ENCRYPTION_KEY || DEFAULT_KEY;
  if (!process.env.ENCRYPTION_KEY && process.env.NODE_ENV !== "test") {
    console.warn("Using default encryption key. Set ENCRYPTION_KEY in prod.");
  }
  return Buffer.from(hex, "hex");
}

export function encryptToken(token: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(payload: string) {
  const [ivHex, tagHex, encryptedHex] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
