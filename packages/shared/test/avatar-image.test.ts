import { describe, expect, it } from "vitest";
import { isAnimatedImage, sniffImage, stripImageMetadata } from "../src/avatar-image";

// Minimal files built byte by byte: only the structure matters here, not the pixels.

const bytes = (...parts: (number[] | string | Uint8Array)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : [...p])),
  );
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const has = (file: Uint8Array, text: string) => String.fromCharCode(...file).includes(text);

// ---------- GIF ----------
const GIF_HEADER = bytes("GIF89a", [1, 0, 1, 0, 0x80, 0, 0], [0, 0, 0, 255, 255, 255]);
const GIF_FRAME = bytes(
  [0x21, 0xf9, 4, 0, 10, 0, 0, 0],
  [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0],
  [2, 2, 0x44, 1, 0],
);
const NETSCAPE = bytes([0x21, 0xff, 11], "NETSCAPE2.0", [3, 1, 0, 0, 0]);
const GIF_XMP = bytes([0x21, 0xff, 11], "XMP DataXMP", [5], "gps=1", [0]);
const GIF_COMMENT = bytes([0x21, 0xfe, 6], "author", [0]);
const gif = (...blocks: Uint8Array[]) => bytes(GIF_HEADER, ...blocks, [0x3b]);

// ---------- PNG ----------
const pngChunk = (type: string, data: number[] | string = []) => {
  const body = bytes(data);
  return bytes(u32be(body.length), type, body, [0, 0, 0, 0]);
};
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (...chunks: Uint8Array[]) =>
  bytes(
    PNG_SIG,
    pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...chunks,
    pngChunk("IDAT", [1, 2, 3]),
    pngChunk("IEND"),
  );

// ---------- WebP ----------
const webpChunk = (type: string, data: number[] | string) => {
  const body = bytes(data);
  return bytes(type, u32le(body.length), body, body.length % 2 ? [0] : []);
};
const webp = (flags: number, ...chunks: Uint8Array[]) => {
  const body = bytes("WEBP", webpChunk("VP8X", [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...chunks);
  return bytes("RIFF", u32le(body.length), body);
};
const ANIM = webpChunk("ANIM", [0, 0, 0, 0, 0, 0]);
const ANMF = webpChunk("ANMF", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const EXIF = webpChunk("EXIF", "Exif gps");

describe("sniffImage", () => {
  it("reads the real type from the first bytes", () => {
    expect(sniffImage(gif(GIF_FRAME))).toBe("image/gif");
    expect(sniffImage(png())).toBe("image/png");
    expect(sniffImage(webp(0))).toBe("image/webp");
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(bytes("<svg onload='x'/>"))).toBeNull();
  });
});

describe("isAnimatedImage", () => {
  it("tells animations from still pictures", () => {
    expect(isAnimatedImage(gif(NETSCAPE, GIF_FRAME, GIF_FRAME))).toBe(true);
    expect(isAnimatedImage(gif(GIF_FRAME))).toBe(false);
    expect(isAnimatedImage(webp(0x02, ANIM, ANMF, ANMF))).toBe(true);
    expect(isAnimatedImage(webp(0))).toBe(false);
    expect(isAnimatedImage(png(pngChunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0])))).toBe(true);
    expect(isAnimatedImage(png())).toBe(false);
  });

  it("treats truncated files as not animated", () => {
    const full = gif(NETSCAPE, GIF_FRAME, GIF_FRAME);
    expect(isAnimatedImage(full.subarray(0, full.length - 8))).toBe(false);
  });
});

describe("stripImageMetadata", () => {
  it("drops GIF comments and XMP but keeps frames and looping", () => {
    const clean = stripImageMetadata(gif(NETSCAPE, GIF_XMP, GIF_COMMENT, GIF_FRAME, GIF_FRAME));
    expect(clean).toEqual(gif(NETSCAPE, GIF_FRAME, GIF_FRAME));
    expect(clean && isAnimatedImage(clean)).toBe(true);
  });

  it("drops PNG text and EXIF chunks but keeps the animation", () => {
    const acTL = pngChunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]);
    const clean = stripImageMetadata(
      png(acTL, pngChunk("tEXt", "GPS\0-25.3"), pngChunk("eXIf", "gps")),
    );
    expect(clean).toEqual(png(acTL));
  });

  it("drops WebP EXIF and XMP, clears their flags and fixes the RIFF size", () => {
    const xmp = webpChunk("XMP ", "<x:gps/>");
    const clean = stripImageMetadata(webp(0x02 | 0x04 | 0x08, ANIM, ANMF, EXIF, xmp));
    expect(clean).toEqual(webp(0x02, ANIM, ANMF));
    expect(clean && has(clean, "gps")).toBe(false);
    expect(clean && isAnimatedImage(clean)).toBe(true);
  });

  it("returns null for files it cannot read", () => {
    const full = webp(0x02, ANIM, ANMF);
    expect(stripImageMetadata(full.subarray(0, full.length - 3))).toBeNull();
    expect(stripImageMetadata(bytes([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
