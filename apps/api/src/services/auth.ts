import { createHmac } from "node:crypto";
import type { Db } from "../db/client";
import type { User } from "../generated/prisma/client";
import { ApiError } from "../lib/errors";
import { newId } from "../lib/ids";
import { hashPassword, verifyPassword } from "../lib/password";
import { newSecretToken } from "../lib/tokens";

export const SESSION_COOKIE = "puente_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

/** HMAC with SESSION_SECRET: a leaked sessions table alone cannot be replayed. */
export function hashSessionToken(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

let dummyHash: Promise<string> | undefined;
/** Verifying against a throwaway hash keeps unknown e-mails as slow as known ones. */
function timingDummy(): Promise<string> {
  dummyHash ??= hashPassword("timing-equalizer-not-a-real-password");
  return dummyHash;
}

const INVALID = () => new ApiError(401, "invalid_credentials", "Correo o contraseña incorrectos");

export async function login(
  db: Db,
  secret: string,
  email: string,
  password: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date; user: User }> {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    await verifyPassword(await timingDummy(), password);
    throw INVALID();
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    throw new ApiError(429, "too_many_attempts", "Demasiados intentos. Espera 15 minutos.");
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(now.getTime() + LOCKOUT_MS) : null,
      },
    });
    if (lock) {
      throw new ApiError(429, "too_many_attempts", "Demasiados intentos. Espera 15 minutos.");
    }
    throw INVALID();
  }

  const token = newSecretToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } }),
    db.session.create({
      data: {
        id: newId("ses"),
        tokenHash: hashSessionToken(secret, token),
        userId: user.id,
        expiresAt,
      },
    }),
  ]);
  return { token, expiresAt, user };
}

export async function findSession(db: Db, secret: string, token: string, now: Date) {
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(secret, token) },
    include: { user: { include: { business: { select: { id: true, name: true } } } } },
  });
  if (!session || session.expiresAt <= now) return null;
  return session;
}

export async function logout(db: Db, secret: string, token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashSessionToken(secret, token) } });
}
