import type { BusinessCreate, BusinessCreateResponse, PlatformBusiness } from "@puente/shared";
import type { Db } from "../db/client";
import type { Business } from "../generated/prisma/client";
import { ApiError } from "../lib/errors";
import { newId, newPublicKey } from "../lib/ids";
import { localMonth, startOfLocalDay } from "../lib/time";
import { estimateCostUsd, type LlmPrices } from "./admin";
import { businessProvider } from "./llm-router";
import { createUser, emailTaken, isUniqueViolation } from "./users";

// Platform operator only: the one place that reads across businesses, on purpose.

const slugTaken = () =>
  new ApiError(409, "slug_taken", "Ya existe una empresa con ese identificador.");

type BusinessRow = Pick<
  Business,
  | "id"
  | "slug"
  | "name"
  | "kind"
  | "active"
  | "createdAt"
  | "timezone"
  | "monthlyConversationQuota"
  | "llmProvider"
>;

/** UTC instant the business's current local month started. */
function monthStart(now: Date, timeZone: string): Date {
  return startOfLocalDay(new Date(`${localMonth(now, timeZone)}-01T12:00:00Z`), timeZone);
}

/** This month's customer messages, AI tokens and pending cases of one business. */
async function monthActivity(db: Db, b: BusinessRow, now: Date) {
  const sinceMonthStart = {
    createdAt: { gte: monthStart(now, b.timezone) },
    conversation: { businessId: b.id, isPreview: false },
  };
  const [messages, tokens, pending] = await Promise.all([
    db.message.count({ where: { ...sinceMonthStart, role: "USER" } }),
    db.message.aggregate({
      where: { ...sinceMonthStart, role: "ASSISTANT" },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    db.handoff.count({
      where: { businessId: b.id, status: "PENDING", conversation: { isPreview: false } },
    }),
  ]);
  return {
    messages,
    input: tokens._sum.inputTokens ?? 0,
    output: tokens._sum.outputTokens ?? 0,
    pending,
  };
}

async function toPlatformBusinesses(
  db: Db,
  businesses: BusinessRow[],
  now: Date,
  prices: LlmPrices,
): Promise<PlatformBusiness[]> {
  const ids = businesses.map((b) => b.id);
  // A handful of businesses: one small query set each is clearer than a cross-timezone join.
  const activity = await Promise.all(businesses.map((b) => monthActivity(db, b, now)));
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
  return businesses.map((b, i) => {
    const month = localMonth(now, b.timezone);
    const act = activity[i] ?? { messages: 0, input: 0, output: 0, pending: 0 };
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
      messagesThisMonth: act.messages,
      costThisMonthUsd: estimateCostUsd(b, act.input, act.output, prices),
      llmProvider: businessProvider(b),
      pendingHandoffs: act.pending,
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
  llmProvider: true,
} as const;

export async function listBusinesses(
  db: Db,
  now: Date,
  prices: LlmPrices,
): Promise<PlatformBusiness[]> {
  const businesses = await db.business.findMany({ select: businessRow, orderBy: { name: "asc" } });
  return toPlatformBusinesses(db, businesses, now, prices);
}

/**
 * Sets the monthly conversation quota (null = no cap). This month's 80 % / 100 % alerts are
 * re-armed, so a raised quota warns again when the new thresholds are crossed.
 */
export async function setBusinessQuota(
  db: Db,
  businessId: string,
  quota: number | null,
  now: Date,
  prices: LlmPrices,
): Promise<PlatformBusiness> {
  const business = await db.business.findUnique({ where: { id: businessId }, select: businessRow });
  if (!business) throw new ApiError(404, "business_not_found", "Empresa no encontrada");
  const [updated] = await db.$transaction([
    db.business.update({
      where: { id: businessId },
      data: { monthlyConversationQuota: quota },
      select: businessRow,
    }),
    db.usageMonth.updateMany({
      where: { businessId, month: localMonth(now, business.timezone) },
      data: { alert80SentAt: null, alert100SentAt: null },
    }),
  ]);
  const [summary] = await toPlatformBusinesses(db, [updated], now, prices);
  if (!summary) throw new Error("updated business missing");
  return summary;
}

/** Business with working defaults (edited later in Configuración) plus its first ADMIN. */
export async function createBusiness(
  db: Db,
  input: BusinessCreate,
  now: Date,
  prices: LlmPrices,
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
    const [summary] = await toPlatformBusinesses(db, [business], now, prices);
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
