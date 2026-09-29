import { AVATAR_MAX_BYTES } from "@puente/shared";
import type { Db } from "../db/client";
import { ApiError } from "../lib/errors";

type AvatarMime = "image/png" | "image/jpeg" | "image/webp";

/** Real file type from its first bytes: the declared type is never trusted (no SVG, no HTML). */
function sniff(data: Buffer): AvatarMime | null {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return "image/jpeg";
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Decodes a validated data URL (AvatarUploadSchema) into bytes, checking size and real type. */
export function decodeAvatar(dataUrl: string): { mimeType: AvatarMime; data: Buffer } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
  if (!match?.[1] || !match[2])
    throw new ApiError(400, "invalid_request", "Imagen PNG, JPG o WebP");
  const data = Buffer.from(match[2], "base64");
  if (data.length === 0 || data.length > AVATAR_MAX_BYTES) {
    throw new ApiError(400, "invalid_request", "La imagen debe pesar hasta 200 KB");
  }
  const real = sniff(data);
  if (!real || real !== match[1]) {
    throw new ApiError(
      400,
      "invalid_request",
      "El archivo no es una imagen PNG, JPG o WebP válida",
    );
  }
  return { mimeType: real, data };
}

/** Public URL of the picture; the version changes with each upload so caches refresh. */
export function avatarUrl(
  publicApiUrl: string,
  publicKey: string,
  updatedAt: Date | null,
): string | null {
  if (!updatedAt) return null;
  const base = publicApiUrl.replace(/\/+$/, "");
  return `${base}/v1/widget/avatar/${encodeURIComponent(publicKey)}?v=${updatedAt.getTime()}`;
}

export async function avatarUpdatedAt(db: Db, businessId: string): Promise<Date | null> {
  const row = await db.businessAvatar.findUnique({
    where: { businessId },
    select: { updatedAt: true },
  });
  return row?.updatedAt ?? null;
}

export async function saveAvatar(db: Db, businessId: string, dataUrl: string): Promise<void> {
  const { mimeType, data } = decodeAvatar(dataUrl);
  const bytes = new Uint8Array(data);
  await db.businessAvatar.upsert({
    where: { businessId },
    create: { businessId, mimeType, data: bytes },
    update: { mimeType, data: bytes },
  });
}

export async function removeAvatar(db: Db, businessId: string): Promise<void> {
  await db.businessAvatar.deleteMany({ where: { businessId } });
}
