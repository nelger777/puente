import { randomBytes } from "node:crypto";
import argon2 from "argon2";

/** 16 url-safe characters (96 bits) for accounts created from the panel; shown once. */
export function newPassword(): string {
  return randomBytes(12).toString("base64url");
}

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
