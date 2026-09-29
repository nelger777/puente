import { describe, expect, it } from "vitest";
import { squareCrop } from "../src/lib/resize-image";

describe("squareCrop", () => {
  it("crops a landscape photo to its centered square and scales it down to 256", () => {
    expect(squareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, side: 3000, out: 256 });
  });

  it("crops a portrait picture from the middle", () => {
    expect(squareCrop(1080, 1920)).toEqual({ sx: 0, sy: 420, side: 1080, out: 256 });
  });

  it("never upscales a small picture", () => {
    expect(squareCrop(120, 100)).toEqual({ sx: 10, sy: 0, side: 100, out: 100 });
  });
});
