import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/password";

describe("password hashing", () => {
  it("uses argon2id and verifies only the right password", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "correct horse")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});
