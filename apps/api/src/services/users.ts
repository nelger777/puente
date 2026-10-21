import type {
  UserCreate,
  UserListResponse,
  UserPatch,
  UserRole,
  UserSummary,
  UserWithPassword,
} from "@puente/shared";
import type { Db } from "../db/client";
import { Prisma, type User } from "../generated/prisma/client";
import { ApiError } from "../lib/errors";
import { newId } from "../lib/ids";
import { hashPassword, newPassword } from "../lib/password";

// Users of one business, managed by its ADMINs (or a platform admin who entered it).
// Every query filters by businessId; platform admins never show up here and cannot be
// changed from a business, even when their own account belongs to it.

const scoped = (businessId: string) => ({ businessId, isPlatformAdmin: false });

export function toUserSummary(user: User): UserSummary {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function listUsers(db: Db, businessId: string): Promise<UserListResponse> {
  const users = await db.user.findMany({
    where: scoped(businessId),
    orderBy: { createdAt: "asc" },
  });
  return { users: users.map(toUserSummary) };
}

export const emailTaken = () =>
  new ApiError(409, "email_taken", "Ya existe un usuario con ese correo.");

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Creates the user with a generated password, returned once. Accepts a transaction client. */
export async function createUser(
  db: Db | Prisma.TransactionClient,
  businessId: string,
  input: UserCreate,
): Promise<UserWithPassword> {
  const password = newPassword();
  try {
    const user = await db.user.create({
      data: {
        id: newId("usr"),
        businessId,
        email: input.email,
        role: input.role,
        passwordHash: await hashPassword(password),
      },
    });
    return { user: toUserSummary(user), password };
  } catch (err) {
    if (isUniqueViolation(err)) throw emailTaken();
    throw err;
  }
}

async function findUser(db: Db, businessId: string, userId: string): Promise<User> {
  const user = await db.user.findFirst({ where: { id: userId, ...scoped(businessId) } });
  if (!user) throw new ApiError(404, "user_not_found", "Usuario no encontrado");
  return user;
}

/** A business always keeps at least one active ADMIN, so nobody is locked out of it. */
async function assertKeepsAnAdmin(db: Db, businessId: string, userId: string): Promise<void> {
  const others = await db.user.count({
    where: { ...scoped(businessId), role: "ADMIN", active: true, id: { not: userId } },
  });
  if (others === 0) {
    throw new ApiError(409, "last_admin", "La empresa necesita al menos un administrador activo.");
  }
}

export async function updateUser(
  db: Db,
  businessId: string,
  actorId: string,
  userId: string,
  patch: UserPatch,
): Promise<UserSummary> {
  if (userId === actorId) {
    throw new ApiError(
      409,
      "cannot_change_self",
      "No puedes cambiar tu propio rol ni desactivarte.",
    );
  }
  const user = await findUser(db, businessId, userId);
  const role: UserRole = patch.role ?? user.role;
  const active = patch.active ?? user.active;
  if (user.role === "ADMIN" && user.active && (role !== "ADMIN" || !active)) {
    await assertKeepsAnAdmin(db, businessId, userId);
  }
  const updated = await db.$transaction(async (tx) => {
    // A disabled user is logged out everywhere at once.
    if (!active) await tx.session.deleteMany({ where: { userId: user.id } });
    return tx.user.update({ where: { id: user.id }, data: { role, active } });
  });
  return toUserSummary(updated);
}

/** New generated password (returned once); ends the user's sessions and clears any lockout. */
export async function resetPassword(
  db: Db,
  businessId: string,
  actorId: string,
  userId: string,
): Promise<UserWithPassword> {
  if (userId === actorId) {
    throw new ApiError(
      409,
      "cannot_change_self",
      "No puedes restablecer tu propia contraseña aquí.",
    );
  }
  const user = await findUser(db, businessId, userId);
  const password = newPassword();
  const [updated] = await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null },
    }),
    db.session.deleteMany({ where: { userId: user.id } }),
  ]);
  return { user: toUserSummary(updated), password };
}
