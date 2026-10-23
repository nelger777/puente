import {
  AVATAR_ANIMATED_MAX_BYTES,
  AVATAR_MAX_BYTES,
  isAnimatedImage,
  sniffImage,
  stripImageMetadata,
  type AvatarMime,
} from "@puente/shared";
import type { Db } from "../db/client";
import { ApiError } from "../lib/errors";

const invalid = (message: string) => new ApiError(400, "invalid_request", message);

/**
 * Decodes a validated data URL (AvatarUploadSchema) into bytes, checking size and real type.
 * Animations (GIF, WebP, APNG) arrive as uploaded, so their metadata is stripped here.
 */
export function decodeAvatar(dataUrl: string): { mimeType: AvatarMime; data: Buffer } {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl);
  if (!match?.[1] || !match[2]) throw invalid("Imagen PNG, JPG, WebP o GIF");
  const raw = Buffer.from(match[2], "base64");
  const real = sniffImage(raw);
  if (!real || real !== match[1]) {
    throw invalid("El archivo no es una imagen PNG, JPG, WebP o GIF válida");
  }
  const animated = isAnimatedImage(raw);
  const max = animated ? AVATAR_ANIMATED_MAX_BYTES : AVATAR_MAX_BYTES;
  if (raw.length > max) {
    throw invalid(
      animated ? "La animación debe pesar hasta 1000 KB" : "La imagen debe pesar hasta 200 KB",
    );
  }
  if (real === "image/jpeg") return { mimeType: real, data: raw };
  const clean = stripImageMetadata(raw);
  if (!clean) throw invalid("La imagen está dañada o incompleta");
  return { mimeType: real, data: Buffer.from(clean) };
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
