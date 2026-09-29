import { AVATAR_MAX_BYTES } from "@puente/shared";

/** What the panel accepts before shrinking; the server keeps its own 200 KB limit. */
export const AVATAR_INPUT_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_SIDE = 256;

export interface Crop {
  sx: number;
  sy: number;
  side: number;
  /** Output side: never upscales a small picture. */
  out: number;
}

/** Centered square crop of a width × height picture, scaled down to at most `max` px. */
export function squareCrop(width: number, height: number, max = AVATAR_SIDE): Crop {
  const side = Math.min(width, height);
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
    out: Math.min(side, max),
  };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("No se pudo leer la imagen"));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Shrinks a picture to a 256×256 square in the browser (EXIF, GPS included, is dropped by
 * re-encoding). WebP keeps transparency; browsers that cannot encode WebP get PNG, and a JPEG
 * on white if the PNG is still over the server limit.
 */
export async function resizeToAvatar(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("No se pudo abrir la imagen. Prueba con un PNG, JPG o WebP.");
  }
  const crop = squareCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = crop.out;
  canvas.height = crop.out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede procesar imágenes");
  ctx.imageSmoothingQuality = "high";

  const draw = (background?: string) => {
    ctx.clearRect(0, 0, crop.out, crop.out);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, crop.out, crop.out);
    }
    ctx.drawImage(bitmap, crop.sx, crop.sy, crop.side, crop.side, 0, 0, crop.out, crop.out);
  };

  draw();
  const candidates: [string, number | undefined][] = [
    ["image/webp", 0.9],
    ["image/png", undefined],
  ];
  for (const [type, quality] of candidates) {
    const blob = await toBlob(canvas, type, quality);
    // A browser that cannot encode the type silently returns PNG: check what came back.
    if (blob && blob.type === type && blob.size <= AVATAR_MAX_BYTES) return toDataUrl(blob);
  }
  draw("#ffffff");
  const jpeg = await toBlob(canvas, "image/jpeg", 0.88);
  if (jpeg && jpeg.size <= AVATAR_MAX_BYTES) return toDataUrl(jpeg);
  throw new Error("No se pudo reducir la imagen. Prueba con otra.");
}
