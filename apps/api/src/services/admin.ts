import {
  HandoffCodeSchema,
  HandoffReasonSchema,
  type BusinessResponse,
  type BusinessSettings,
  type HandoffDetail,
  type HandoffListQuery,
  type HandoffListResponse,
  type HandoffReason,
  type HandoffStatus,
  type HandoffSummary,
  type MetricsResponse,
  type TeamResponse,
} from "@puente/shared";
import type { Db } from "../db/client";
import { businessHours, businessVoice } from "../engine/business";
import type { Business, Prisma } from "../generated/prisma/client";
import { ApiError } from "../lib/errors";
import { newId } from "../lib/ids";
import { localMonth, startOfLocalDay } from "../lib/time";
import { languageCounts, topQuestions, weeklySeries, type ConversationFacts } from "./insights";
import { businessProvider } from "./llm-router";

export const HANDOFF_PAGE_SIZE = 25;
/** Bounds the summary's per-conversation work (~90 days of a busy site). */
const INSIGHTS_MAX_CONVERSATIONS = 20_000;
const INSIGHTS_MESSAGES_PER_CONVERSATION = 20;

/** USD per million tokens. Cache reads/writes are counted as regular input (an estimate). */
export interface LlmPrices {
  inputPerMTok: number;
  outputPerMTok: number;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** AI cost estimate in USD. Gemini on the free tier costs nothing (demo use); history is priced
 * with the business's current engine. */
export function estimateCostUsd(
  business: Pick<Business, "llmProvider">,
  inputTokens: number,
  outputTokens: number,
  prices: LlmPrices,
): number {
  if (businessProvider(business) === "gemini") return 0;
  return round4(
    (inputTokens * prices.inputPerMTok + outputTokens * prices.outputPerMTok) / 1_000_000,
  );
}

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
    offHoursWhatsappNumber: business.offHoursWhatsappNumber,
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

const summaryInclude = {
  events: { orderBy: { createdAt: "desc" }, take: 1 },
  assignedTo: { select: { id: true, email: true } },
  _count: { select: { notes: true } },
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
    assignee: h.assignedTo,
    noteCount: h._count.notes,
  };
}

/** Real cases only: "Probar" conversations never reach the inbox or the metrics. */
function realHandoffs(businessId: string): Prisma.HandoffWhereInput {
  return { businessId, conversation: { isPreview: false } };
}

/**
 * Inbox search: a case code; otherwise the contact name, the summary or the phone. Phones are
 * compared by their digits, so "0981 123 456" finds "0981-123456".
 */
async function searchHandoffs(
  db: Db,
  businessId: string,
  q: string,
): Promise<Prisma.HandoffWhereInput> {
  const code = HandoffCodeSchema.safeParse(q.toUpperCase().replace(/\s+/g, ""));
  if (code.success) return { code: code.data };
  const or: Prisma.HandoffWhereInput[] = [
    { contactName: { contains: q, mode: "insensitive" } },
    { summary: { contains: q, mode: "insensitive" } },
  ];
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4) {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Handoff"
      WHERE "businessId" = ${businessId}
        AND regexp_replace(coalesce("contactPhone", ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}
      LIMIT 500`;
    if (rows.length) or.push({ id: { in: rows.map((r) => r.id) } });
  }
  return { OR: or };
}

/** "me", "none" or a teammate's id. businessId already scopes the query, so another
 * business's user id simply matches nothing. */
function assigneeFilter(assignee: string, actorUserId: string): string | null {
  if (assignee === "me") return actorUserId;
  if (assignee === "none") return null;
  return assignee;
}

export async function listHandoffs(
  db: Db,
  businessId: string,
  actorUserId: string,
  query: HandoffListQuery,
): Promise<HandoffListResponse> {
  const { status, assignee, q, cursor } = query;
  const where: Prisma.HandoffWhereInput = {
    ...realHandoffs(businessId),
    ...(status ? { status } : {}),
    ...(assignee ? { assignedToId: assigneeFilter(assignee, actorUserId) } : {}),
    ...(q ? { AND: await searchHandoffs(db, businessId, q) } : {}),
  };
  const rows = await db.handoff.findMany({
    where,
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
      assignedTo: { select: { id: true, email: true } },
      _count: { select: { notes: true } },
      notes: { orderBy: { createdAt: "asc" }, include: { author: { select: { email: true } } } },
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
    notes: h.notes.map((n) => ({
      id: n.id,
      author: n.author?.email ?? null,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
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

/**
 * Active users of the business. The platform operator counts in their own business (where they
 * also work cases), not in the ones they only enter.
 */
function teamMembers(businessId: string): Prisma.UserWhereInput {
  return { businessId, active: true };
}

export async function listTeam(db: Db, businessId: string): Promise<TeamResponse> {
  const members = await db.user.findMany({
    where: teamMembers(businessId),
    orderBy: { email: "asc" },
    select: { id: true, email: true },
  });
  return { members };
}

/** Any user of the business may assign a case to anyone on the team, or unassign it. */
export async function setHandoffAssignee(
  db: Db,
  businessId: string,
  code: string,
  assigneeId: string | null,
  actorUserId: string,
): Promise<HandoffDetail> {
  const h = await findHandoff(db, businessId, code);
  if (h.assignedToId === assigneeId) return getHandoff(db, businessId, code);
  if (assigneeId) {
    const member = await db.user.findFirst({
      where: { ...teamMembers(businessId), id: assigneeId },
    });
    if (!member) throw new ApiError(400, "invalid_request", "Ese usuario no es parte del equipo.");
  }
  await db.$transaction([
    db.handoff.update({ where: { id: h.id }, data: { assignedToId: assigneeId } }),
    db.handoffEvent.create({
      data: {
        id: newId("hev"),
        handoffId: h.id,
        type: assigneeId ? "assigned" : "unassigned",
        actor: actorUserId,
      },
    }),
  ]);
  return getHandoff(db, businessId, code);
}

export async function addHandoffNote(
  db: Db,
  businessId: string,
  code: string,
  body: string,
  authorId: string,
): Promise<HandoffDetail> {
  const h = await findHandoff(db, businessId, code);
  await db.handoffNote.create({ data: { id: newId("hno"), handoffId: h.id, authorId, body } });
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
    periodConversations,
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
    // Weekly trend, languages and top questions are computed from the period's conversations.
    db.conversation.findMany({
      where: conversationsInRange,
      take: INSIGHTS_MAX_CONVERSATIONS,
      orderBy: { startedAt: "desc" },
      select: {
        startedAt: true,
        handoffs: { select: { id: true }, take: 1 },
        messages: {
          where: { role: "USER" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: INSIGHTS_MESSAGES_PER_CONVERSATION,
          select: { content: true },
        },
      },
    }),
  ]);
  // Oldest first: a repeated question is shown the way it was first asked.
  const facts: ConversationFacts[] = periodConversations.toReversed().map((c) => ({
    day: dayString(c.startedAt, business.timezone),
    handedOff: c.handoffs.length > 0,
    userTexts: c.messages.map((m) => m.content),
  }));

  const failures = { timeout: 0, api_error: 0, invalid_output: 0 };
  for (const row of failuresByKind) {
    if (row.llmError && row.llmError in failures) {
      failures[row.llmError as keyof typeof failures] = row._count._all;
    }
  }
  const failed = failures.timeout + failures.api_error + failures.invalid_output;
  const inputTokens = tokens._sum.inputTokens ?? 0;
  const outputTokens = tokens._sum.outputTokens ?? 0;
  const cost = estimateCostUsd(business, inputTokens, outputTokens, prices);

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
    languages: languageCounts(facts),
    weekly: weeklySeries(facts, fromDay, toDay),
    topQuestions: topQuestions(facts),
    pendingCount,
    recentPending: recent.map(toSummary),
    usage: {
      month: localMonth(now, business.timezone),
      conversations: usage?.conversations ?? 0,
      quota: business.monthlyConversationQuota,
    },
  };
}
