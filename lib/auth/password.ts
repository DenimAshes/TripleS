import bcrypt from "bcryptjs";

const BCRYPT_MAX_BYTES = 72;

function isSupportedPassword(password: string) {
  return Buffer.byteLength(password, "utf8") <= BCRYPT_MAX_BYTES;
}

export async function hashPassword(password: string) {
  if (!isSupportedPassword(password)) throw new Error("Password must be at most 72 UTF-8 bytes.");
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  if (!isSupportedPassword(password)) return false;
  return bcrypt.compare(password, hash);
}
