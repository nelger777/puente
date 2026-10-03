import {
  HandoffReasonSchema,
  type BusinessResponse,
  type BusinessSettings,
  type HandoffDetail,
  type HandoffListResponse,
  type HandoffReason,
  type HandoffStatus,
  type HandoffSummary,
  type KnowledgeItemInput,
  type KnowledgeResponse,
  type MetricsResponse,
} from "@puente/shared";
import type { Db } from "../db/client";
import { businessHours, businessVoice } from "../engine/business";
import type { Business, Prisma } from "../generated/prisma/client";
import { ApiError } from "../lib/errors";
import { newId } from "../lib/ids";
import { localMonth, startOfLocalDay } from "../lib/time";
import { businessProvider } from "./llm-router";

export const HANDOFF_PAGE_SIZE = 25;

/** USD per million tokens. Cache reads/writes are counted as regular input (an estimate). */
export interface LlmPrices {
  inputPerMTok: number;
  outputPerMTok: number;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

// Every query below filters by businessId: the session's business is the only scope.

export function toBusinessResponse(
  business: Business,
  widgetBaseUrl: string,
  avatarUrl: string | null,
): BusinessResponse {
  return {
    id: business.id,
    slug: business.slug,
    publicKey: business.publicKey,
    widgetScriptUrl: `${widgetBaseUrl.replace(/\/+$/, "")}/v1.js`,
    avatarUrl,
    name: business.name,
    kind: business.kind,
    botName: business.botName,
    voice: businessVoice(business),
    brandColor: business.brandColor,
    whatsappNumber: business.whatsappNumber,
    notifyEmail: business.notifyEmail,
    timezone: business.timezone,
    hours: businessHours(business),
    offHoursMessage: business.offHoursMessage,
    greeting: business.greeting,
    suggestions: business.suggestions,
    sensitiveTopics: business.sensitiveTopics,
    allowedDomains: business.allowedDomains,
    maxMessagesPerConv: business.maxMessagesPerConv,
    dailyMessageCap: business.dailyMessageCap,
    active: business.active,
    llm: {
      provider: businessProvider(business),
      hasKey: business.llmApiKeySealed !== null,
      keyLast4: business.llmApiKeyLast4,
    },
  };
}

export async function getBusiness(db: Db, businessId: string): Promise<Business> {
  const business = await db.business.findUnique({ where: { id: businessId } });
  if (!business) throw new ApiError(404, "business_not_found", "Business not found");
  return business;
}

export function updateBusiness(db: Db, businessId: string, settings: BusinessSettings) {
  return db.business.update({ where: { id: businessId }, data: settings });
}

export async function listKnowledge(db: Db, businessId: string): Promise<KnowledgeResponse> {
  const items = await db.knowledgeItem.findMany({
    where: { businessId },
    orderBy: { position: "asc" },
    select: { id: true, question: true, answer: true, position: true },
  });
  return { items };
}

/** Replaces the whole knowledge base atomically (docs/SPEC.md §4). */
export async function replaceKnowledge(
  db: Db,
  businessId: string,
  items: KnowledgeItemInput[],
): Promise<KnowledgeResponse> {
  await db.$transaction([
    db.knowledgeItem.deleteMany({ where: { businessId } }),
    db.knowledgeItem.createMany({
      data: items.map((item, position) => ({
        id: newId("kb"),
        businessId,
        question: item.question,
        answer: item.answer,
        position,
      })),
    }),
  ]);
  return listKnowledge(db, businessId);
}

const summaryInclude = {
  events: { orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.HandoffInclude;

type HandoffWithLastEvent = Prisma.HandoffGetPayload<{ include: typeof summaryInclude }>;

function toSummary(h: HandoffWithLastEvent): HandoffSummary {
  const last = h.events[0];
  return {
    code: h.code,
    reason: h.reason,
    status: h.status,
    createdAt: h.createdAt.toISOString(),
    openedInHours: h.openedInHours,
    summary: h.summary,
    contactName: h.contactName,
    contactPhone: h.contactPhone,
    lastEvent: last
      ? { type: last.type, actor: last.actor, createdAt: last.createdAt.toISOString() }
      : null,
  };
}

/** Real cases only: "Probar" conversations never reach the inbox or the metrics. */
function realHandoffs(businessId: string): Prisma.HandoffWhereInput {
  return { businessId, conversation: { isPreview: false } };
}

export async function listHandoffs(
  db: Db,
  businessId: string,
  status: HandoffStatus | undefined,
  cursor: string | undefined,
): Promise<HandoffListResponse> {
  const rows = await db.handoff.findMany({
    where: { ...realHandoffs(businessId), ...(status ? { status } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HANDOFF_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: summaryInclude,
  });
  const page = rows.slice(0, HANDOFF_PAGE_SIZE);
  const pendingCount = await db.handoff.count({
    where: { ...realHandoffs(businessId), status: "PENDING" },
  });
  return {
    items: page.map(toSummary),
    nextCursor: rows.length > HANDOFF_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    pendingCount,
  };
}

async function findHandoff(db: Db, businessId: string, code: string) {
  const handoff = await db.handoff.findFirst({
    where: { businessId, code },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      conversation: {
        include: { messages: { orderBy: [{ createdAt: "asc" }, { role: "asc" }] } },
      },
    },
  });
  if (!handoff) throw new ApiError(404, "handoff_not_found", "Handoff not found");
  return handoff;
}

export async function getHandoff(db: Db, businessId: string, code: string): Promise<HandoffDetail> {
  const h = await findHandoff(db, businessId, code);
  const events = h.events.map((e) => ({
    type: e.type,
    actor: e.actor,
    createdAt: e.createdAt.toISOString(),
  }));
  return {
    ...toSummary({ ...h, events: h.events.slice(-1) }),
    waMessage: h.waMessage,
    resolvedAt: h.resolvedAt?.toISOString() ?? null,
    conversation: {
      id: h.conversation.id,
      startedAt: h.conversation.startedAt.toISOString(),
      originDomain: h.conversation.originDomain,
    },
    messages: h.conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    events,
  };
}

export async function setHandoffStatus(
  db: Db,
  businessId: string,
  code: string,
  status: HandoffStatus,
  actorUserId: string,
  now: Date,
): Promise<HandoffDetail> {
  const h = await findHandoff(db, businessId, code);
  if (h.status !== status) {
    if (status === "PENDING") {
      const otherPending = await db.handoff.count({
        where: { businessId, conversationId: h.conversationId, status: "PENDING" },
      });
      if (otherPending > 0) {
        throw new ApiError(409, "conflict", "La conversación ya tiene otra derivación pendiente");
      }
    }
    await db.$transaction([
      db.handoff.update({
        where: { id: h.id },
        data: { status, resolvedAt: status === "RESOLVED" ? now : null },
      }),
      db.handoffEvent.create({
        data: {
          id: newId("hev"),
          handoffId: h.id,
          type: status === "RESOLVED" ? "resolved" : "reopened",
          actor: actorUserId,
        },
      }),
    ]);
  }
  return getHandoff(db, businessId, code);
}

function dayString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date); // YYYY-MM-DD
}

/** Local-day range [from, to] of the business, as UTC instants [start, end). */
function range(business: Business, from: string | undefined, to: string | undefined, now: Date) {
  const tz = business.timezone;
  const toDay = to ?? dayString(now, tz);
  const fromDay =
    from ?? dayString(new Date(new Date(`${toDay}T12:00:00Z`).getTime() - 29 * 86_400_000), tz);
  const start = startOfLocalDay(new Date(`${fromDay}T12:00:00Z`), tz);
  const end = startOfLocalDay(new Date(new Date(`${toDay}T12:00:00Z`).getTime() + 86_400_000), tz);
  if (start >= end) throw new ApiError(400, "invalid_request", "from must be before to");
  return { fromDay, toDay, start, end };
}

export async function getMetrics(
  db: Db,
  business: Business,
  from: string | undefined,
  to: string | undefined,
  now: Date,
  prices: LlmPrices,
): Promise<MetricsResponse> {
  const { fromDay, toDay, start, end } = range(business, from, to, now);
  const businessId = business.id;
  const conversationsInRange: Prisma.ConversationWhereInput = {
    businessId,
    isPreview: false,
    userMessageCount: { gt: 0 },
    startedAt: { gte: start, lt: end },
  };
  const messagesInRange: Prisma.MessageWhereInput = {
    createdAt: { gte: start, lt: end },
    conversation: { businessId, isPreview: false },
  };
  const handoffsInRange: Prisma.HandoffWhereInput = {
    ...realHandoffs(businessId),
    createdAt: { gte: start, lt: end },
  };

  const [
    conversations,
    resolved,
    userMessages,
    handedOff,
    byReason,
    tokens,
    llmCalls,
    pendingCount,
    recent,
    llmOk,
    failuresByKind,
    usage,
  ] = await Promise.all([
    db.conversation.count({ where: conversationsInRange }),
    db.conversation.count({ where: { ...conversationsInRange, handoffs: { none: {} } } }),
    db.message.count({ where: { ...messagesInRange, role: "USER" } }),
    db.handoff.count({ where: handoffsInRange }),
    db.handoff.groupBy({ by: ["reason"], where: handoffsInRange, _count: { _all: true } }),
    db.message.aggregate({
      where: { ...messagesInRange, role: "ASSISTANT" },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    db.message.count({
      where: { ...messagesInRange, role: "ASSISTANT", inputTokens: { not: null } },
    }),
    db.handoff.count({ where: { ...realHandoffs(businessId), status: "PENDING" } }),
    db.handoff.findMany({
      where: { ...realHandoffs(businessId), status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: summaryInclude,
    }),
    db.message.aggregate({
      where: { ...messagesInRange, role: "ASSISTANT", engine: "llm" },
      _count: { _all: true },
      _avg: { latencyMs: true },
    }),
    db.message.groupBy({
      by: ["llmError"],
      where: { ...messagesInRange, role: "ASSISTANT", llmError: { not: null } },
      _count: { _all: true },
    }),
    db.usageMonth.findUnique({
      where: { businessId_month: { businessId, month: localMonth(now, business.timezone) } },
    }),
  ]);

  const failures = { timeout: 0, api_error: 0, invalid_output: 0 };
  for (const row of failuresByKind) {
    if (row.llmError && row.llmError in failures) {
      failures[row.llmError as keyof typeof failures] = row._count._all;
    }
  }
  const failed = failures.timeout + failures.api_error + failures.invalid_output;
  const inputTokens = tokens._sum.inputTokens ?? 0;
  const outputTokens = tokens._sum.outputTokens ?? 0;
  // Gemini on the free tier costs nothing (demo use); history is priced with the current engine.
  const free = businessProvider(business) === "gemini";
  const cost = free
    ? 0
    : (inputTokens * prices.inputPerMTok + outputTokens * prices.outputPerMTok) / 1_000_000;

  const handoffsByReason = Object.fromEntries(
    HandoffReasonSchema.options.map((r) => [r, 0]),
  ) as Record<HandoffReason, number>;
  for (const row of byReason) handoffsByReason[row.reason] = row._count._all;

  return {
    from: fromDay,
    to: toDay,
    conversations,
    userMessages,
    resolvedByAssistant: resolved,
    handedOff,
    resolutionRate: conversations ? resolved / conversations : 0,
    handoffsByReason,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      llmCalls,
      estimatedCostUsd: round4(cost),
      costPerConversationUsd: conversations ? round4(cost / conversations) : 0,
    },
    llm: {
      failures,
      failureRate: llmOk._count._all + failed ? failed / (llmOk._count._all + failed) : 0,
      avgLatencyMs: llmOk._avg.latencyMs === null ? null : Math.round(llmOk._avg.latencyMs),
    },
    pendingCount,
    recentPending: recent.map(toSummary),
    usage: {
      month: localMonth(now, business.timezone),
      conversations: usage?.conversations ?? 0,
      quota: business.monthlyConversationQuota,
    },
  };
}
