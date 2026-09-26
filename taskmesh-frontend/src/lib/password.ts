import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const keyLength = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await scryptAsync(password, salt, keyLength) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, encodedKey] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !encodedKey) return false;

  const expectedKey = Buffer.from(encodedKey, "base64url");
  const derivedKey = await scryptAsync(password, salt, expectedKey.length) as Buffer;
  return expectedKey.length === derivedKey.length && timingSafeEqual(expectedKey, derivedKey);
}
