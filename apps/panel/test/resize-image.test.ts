import { describe, expect, it } from "vitest";
import { animatedType, squareCrop } from "../src/lib/resize-image";

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

describe("animatedType", () => {
  // Header + 1-color table, then frames (graphic control + 1×1 image), then the trailer.
  const header = [..."GIF89a"]
    .map((c) => c.charCodeAt(0))
    .concat([1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]);
  const frame = [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0];
  const gif = (frames: number, padding = 0) =>
    new Uint8Array([
      ...header,
      ...Array.from({ length: frames }, () => frame).flat(),
      // A comment block, only to make the file heavier.
      ...(padding
        ? [
            0x21,
            0xfe,
            ...Array.from({ length: padding }, () => [
              255,
              ...new Array<number>(255).fill(0),
            ]).flat(),
            0,
          ]
        : []),
      0x3b,
    ]);

  it("keeps an animated GIF as a GIF and lets still pictures be shrunk", () => {
    expect(animatedType(gif(2))).toBe("image/gif");
    expect(animatedType(gif(1))).toBeNull();
  });

  it("refuses an animation over 1000 KB with a clear message", () => {
    expect(() => animatedType(gif(2, 4100))).toThrow(/máximo es 1000 KB/);
  });
});
