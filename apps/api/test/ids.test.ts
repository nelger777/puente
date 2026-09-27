import { describe, expect, it } from "vitest";
import { newId, newPublicKey } from "../src/lib/ids";

describe("newId", () => {
  it("prefixes ids with a readable type", () => {
    expect(newId("conv")).toMatch(/^conv_[a-z0-9]{20,}$/);
    expect(newId("biz")).toMatch(/^biz_/);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId("msg")));
    expect(ids.size).toBe(1000);
  });
});

describe("newPublicKey", () => {
  it("uses the pk_ prefix and url-safe characters", () => {
    expect(newPublicKey()).toMatch(/^pk_[A-Za-z0-9_-]{24}$/);
  });
});
