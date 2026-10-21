import type { BusinessCreate, BusinessCreateResponse, PlatformBusiness } from "@puente/shared";
import type { Db } from "../db/client";
import type { Business } from "../generated/prisma/client";
import { ApiError } from "../lib/errors";
import { newId, newPublicKey } from "../lib/ids";
import { localMonth } from "../lib/time";
import { createUser, emailTaken, isUniqueViolation } from "./users";

// Platform operator only: the one place that reads across businesses, on purpose.

const slugTaken = () =>
  new ApiError(409, "slug_taken", "Ya existe una empresa con ese identificador.");

type BusinessRow = Pick<
  Business,
  "id" | "slug" | "name" | "kind" | "active" | "createdAt" | "timezone" | "monthlyConversationQuota"
>;

async function toPlatformBusinesses(
  db: Db,
  businesses: BusinessRow[],
  now: Date,
): Promise<PlatformBusiness[]> {
  const ids = businesses.map((b) => b.id);
  const [users, usage] = await Promise.all([
    db.user.groupBy({
      by: ["businessId"],
      where: { businessId: { in: ids }, isPlatformAdmin: false },
      _count: { _all: true },
    }),
    db.usageMonth.findMany({
      where: { businessId: { in: ids } },
      select: { businessId: true, month: true, conversations: true },
      orderBy: { month: "desc" },
    }),
  ]);
  return businesses.map((b) => {
    const month = localMonth(now, b.timezone);
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      kind: b.kind,
      active: b.active,
      createdAt: b.createdAt.toISOString(),
      users: users.find((u) => u.businessId === b.id)?._count._all ?? 0,
      conversationsThisMonth:
        usage.find((u) => u.businessId === b.id && u.month === month)?.conversations ?? 0,
      monthlyConversationQuota: b.monthlyConversationQuota,
    };
  });
}

const businessRow = {
  id: true,
  slug: true,
  name: true,
  kind: true,
  active: true,
  createdAt: true,
  timezone: true,
  monthlyConversationQuota: true,
} as const;

export async function listBusinesses(db: Db, now: Date): Promise<PlatformBusiness[]> {
  const businesses = await db.business.findMany({ select: businessRow, orderBy: { name: "asc" } });
  return toPlatformBusinesses(db, businesses, now);
}

/** Business with working defaults (edited later in Configuración) plus its first ADMIN. */
export async function createBusiness(
  db: Db,
  input: BusinessCreate,
  now: Date,
): Promise<BusinessCreateResponse> {
  const { adminEmail, ...fields } = input;
  try {
    const { business, admin } = await db.$transaction(async (tx) => {
      if (await tx.business.findUnique({ where: { slug: fields.slug }, select: { id: true } })) {
        throw slugTaken();
      }
      if (await tx.user.findUnique({ where: { email: adminEmail }, select: { id: true } })) {
        throw emailTaken();
      }
      const business = await tx.business.create({
        data: {
          id: newId("biz"),
          ...fields,
          publicKey: newPublicKey(),
          botName: "Asistente",
          hours: { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" },
          offHoursMessage: "Ahora estamos fuera de horario. Te responderemos apenas abramos.",
          greeting: `¡Hola! Soy el asistente de ${fields.name}. ¿En qué te puedo ayudar?`,
          sensitiveTopics: ["reclamo", "queja"],
        },
        select: businessRow,
      });
      const admin = await createUser(tx, business.id, { email: adminEmail, role: "ADMIN" });
      return { business, admin };
    });
    const [summary] = await toPlatformBusinesses(db, [business], now);
    if (!summary) throw new Error("created business missing");
    return { business: summary, admin: admin.user, password: admin.password };
  } catch (err) {
    // Two operators creating the same slug or e-mail at once: same answer as the checks above.
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "conflict", "El identificador o el correo ya están en uso.");
    }
    throw err;
  }
}

/** Points the session at a business, or back to the operator's own with null. */
export async function actAs(db: Db, sessionId: string, businessId: string | null): Promise<void> {
  if (businessId) {
    const exists = await db.business.findUnique({
      where: { id: businessId },
      select: { id: true },
    });
    if (!exists) throw new ApiError(404, "business_not_found", "Empresa no encontrada");
  }
  await db.session.update({ where: { id: sessionId }, data: { actingBusinessId: businessId } });
}
