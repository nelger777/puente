// Byte-level checks of the assistant picture, shared by the panel (to decide whether a file can
// be shrunk in a canvas, which keeps only the first frame) and the API (to validate and clean
// what is stored). Plain Uint8Array so it runs in the browser and in Node.

export type AvatarMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Real file type from its first bytes: the declared type is never trusted (no SVG, no HTML). */
export function sniffImage(bytes: Uint8Array): AvatarMime | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 13 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) {
    return "image/gif";
  }
  return null;
}

// ---------- PNG: 8-byte signature, then chunks (length BE, type, data, CRC) ----------

interface Chunk {
  type: string;
  start: number;
  end: number;
}

function pngChunks(bytes: Uint8Array): Chunk[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const end = pos + 12 + view.getUint32(pos);
    if (end > bytes.length) return null;
    const type = ascii(bytes, pos + 4, 4);
    chunks.push({ type, start: pos, end });
    pos = end;
    if (type === "IEND") return chunks;
  }
  return null;
}

/** Text and EXIF chunks can carry camera data, GPS or editor notes; none is needed to draw. */
const PNG_METADATA = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

// ---------- WebP: RIFF header, then chunks (fourcc, size LE, data padded to even) ----------

function webpChunks(bytes: Uint8Array): Chunk[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > bytes.length) return null;
  const chunks: Chunk[] = [];
  let pos = 12;
  while (pos + 8 <= riffEnd) {
    const size = view.getUint32(pos + 4, true);
    const end = pos + 8 + size + (size % 2);
    if (end > riffEnd) return null;
    chunks.push({ type: ascii(bytes, pos, 4), start: pos, end });
    pos = end;
  }
  return pos === riffEnd ? chunks : null;
}

const WEBP_FLAG_ANIMATION = 0x02;
const WEBP_FLAG_XMP = 0x04;
const WEBP_FLAG_EXIF = 0x08;

// ---------- GIF: header, screen descriptor, optional color table, then blocks ----------

interface GifBlock {
  /** "image", or "ext:" + label in hex (f9 graphic control, fe comment, ff application…). */
  kind: string;
  start: number;
  end: number;
  /** Application extensions only: identifier + authentication code, e.g. "NETSCAPE2.0". */
  app?: string;
}

/** Skips data sub-blocks (size byte + data) up to and including the 0 terminator. */
function skipSubBlocks(bytes: Uint8Array, pos: number): number | null {
  while (pos < bytes.length) {
    const size = bytes[pos] ?? 0;
    pos += 1 + size;
    if (size === 0) return pos;
  }
  return null;
}

function gifBlocks(bytes: Uint8Array): { headerEnd: number; blocks: GifBlock[] } | null {
  const packed = bytes[10] ?? 0;
  let pos = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  const headerEnd = pos;
  const blocks: GifBlock[] = [];
  while (pos < bytes.length) {
    const start = pos;
    const introducer = bytes[pos];
    if (introducer === 0x3b) return { headerEnd, blocks };
    if (introducer === 0x21) {
      const label = bytes[pos + 1] ?? 0;
      const app = label === 0xff && bytes[pos + 2] === 11 ? ascii(bytes, pos + 3, 11) : undefined;
      const end = skipSubBlocks(bytes, pos + 2);
      if (end === null) return null;
      blocks.push({ kind: `ext:${label.toString(16)}`, start, end, app });
      pos = end;
    } else if (introducer === 0x2c) {
      const local = bytes[pos + 9] ?? 0;
      // 10-byte descriptor, local color table, LZW minimum code size, then the image data.
      pos += 10 + (local & 0x80 ? 3 * 2 ** ((local & 0x07) + 1) : 0) + 1;
      const end = skipSubBlocks(bytes, pos);
      if (end === null) return null;
      blocks.push({ kind: "image", start, end });
      pos = end;
    } else {
      return null;
    }
  }
  return null;
}

/** Looping and frame data; any other application block (XMP, editor data) is metadata. */
const GIF_ANIMATION_APPS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0"]);

// ---------- Public helpers ----------

/** True for a GIF with 2+ frames, an animated WebP or an APNG. Unreadable files are not animated. */
export function isAnimatedImage(bytes: Uint8Array): boolean {
  switch (sniffImage(bytes)) {
    case "image/gif":
      return (gifBlocks(bytes)?.blocks.filter((b) => b.kind === "image").length ?? 0) > 1;
    case "image/webp": {
      const vp8x = webpChunks(bytes)?.find((c) => c.type === "VP8X");
      return !!vp8x && ((bytes[vp8x.start + 8] ?? 0) & WEBP_FLAG_ANIMATION) !== 0;
    }
    case "image/png":
      return pngChunks(bytes)?.some((c) => c.type === "acTL") ?? false;
    default:
      return false;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/**
 * Removes metadata (EXIF, XMP, text, comments) from a PNG, WebP or GIF without re-encoding,
 * so animations survive. Returns null if the file's structure cannot be read. JPEG is not
 * handled: the panel always re-encodes it.
 */
export function stripImageMetadata(bytes: Uint8Array): Uint8Array | null {
  switch (sniffImage(bytes)) {
    case "image/png": {
      const chunks = pngChunks(bytes);
      if (!chunks) return null;
      return concat([
        bytes.subarray(0, 8),
        ...chunks.filter((c) => !PNG_METADATA.has(c.type)).map((c) => bytes.slice(c.start, c.end)),
      ]);
    }
    case "image/webp": {
      const chunks = webpChunks(bytes);
      if (!chunks) return null;
      const kept = chunks
        .filter((c) => c.type !== "EXIF" && c.type !== "XMP ")
        .map((c) => {
          const chunk = bytes.slice(c.start, c.end);
          if (c.type === "VP8X") chunk[8] = (chunk[8] ?? 0) & ~(WEBP_FLAG_EXIF | WEBP_FLAG_XMP);
          return chunk;
        });
      const header = bytes.slice(0, 12);
      const out = concat([header, ...kept]);
      new DataView(out.buffer).setUint32(4, out.length - 8, true);
      return out;
    }
    case "image/gif": {
      const parsed = gifBlocks(bytes);
      if (!parsed) return null;
      const kept = parsed.blocks.filter(
        (b) => b.kind !== "ext:fe" && (b.kind !== "ext:ff" || GIF_ANIMATION_APPS.has(b.app ?? "")),
      );
      return concat([
        bytes.subarray(0, parsed.headerEnd),
        ...kept.map((b) => bytes.subarray(b.start, b.end)),
        new Uint8Array([0x3b]),
      ]);
    }
    default:
      return null;
  }
}
