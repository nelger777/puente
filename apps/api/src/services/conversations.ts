import {
  HandoffCodeSchema,
  type ConversationDetail,
  type ConversationListQuery,
  type ConversationListResponse,
  type ConversationSummary,
} from "@puente/shared";
import type { Db } from "../db/client";
import { conversationLanguage } from "../engine/language";
import type { Business, Prisma } from "../generated/prisma/client";
import { ApiError } from "../lib/errors";
import { startOfLocalDay } from "../lib/time";

export const CONVERSATION_PAGE_SIZE = 25;
const PREVIEW_LENGTH = 160;
/** Enough customer messages to tell the language and show the first one. */
const LANGUAGE_SAMPLE = 20;

const nextDay = (day: string) => new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000);

/** Real conversations of the business (never the panel's "Probar") matching the filters. */
function listWhere(
  business: Business,
  query: ConversationListQuery,
): Prisma.ConversationWhereInput {
  const tz = business.timezone;
  const where: Prisma.ConversationWhereInput = { businessId: business.id, isPreview: false };
  if (query.outcome === "resolved") where.handoffs = { none: {} };
  if (query.outcome === "handed_off") where.handoffs = { some: {} };
  if (query.from || query.to) {
    where.startedAt = {
      ...(query.from ? { gte: startOfLocalDay(new Date(`${query.from}T12:00:00Z`), tz) } : {}),
      ...(query.to ? { lt: startOfLocalDay(nextDay(query.to), tz) } : {}),
    };
  }
  if (query.q) {
    const code = HandoffCodeSchema.safeParse(query.q.toUpperCase());
    where.AND = code.success
      ? { handoffs: { some: { code: code.data } } }
      : { messages: { some: { content: { contains: query.q, mode: "insensitive" } } } };
  }
  return where;
}

const summaryInclude = {
  messages: {
    where: { role: "USER" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: LANGUAGE_SAMPLE,
    select: { content: true },
  },
  handoffs: {
    orderBy: { createdAt: "desc" },
    select: { code: true, reason: true, status: true, createdAt: true },
  },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof summaryInclude }>;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

const handoffOut = (h: ConversationRow["handoffs"][number]) => ({
  code: h.code,
  reason: h.reason,
  status: h.status,
  createdAt: h.createdAt.toISOString(),
});

function toSummary(c: ConversationRow): ConversationSummary {
  const userTexts = c.messages.map((m) => m.content);
  const latest = c.handoffs[0];
  return {
    id: c.id,
    startedAt: c.startedAt.toISOString(),
    lastMessageAt: c.lastMessageAt.toISOString(),
    userMessages: c.userMessageCount,
    preview: preview(userTexts[0] ?? ""),
    language: conversationLanguage(userTexts),
    handoff: latest ? handoffOut(latest) : null,
  };
}

export async function listConversations(
  db: Db,
  business: Business,
  query: ConversationListQuery,
): Promise<ConversationListResponse> {
  const rows = await db.conversation.findMany({
    where: listWhere(business, query),
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: CONVERSATION_PAGE_SIZE + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: summaryInclude,
  });
  const page = rows.slice(0, CONVERSATION_PAGE_SIZE);
  return {
    items: page.map(toSummary),
    nextCursor: rows.length > CONVERSATION_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function getConversation(
  db: Db,
  businessId: string,
  id: string,
): Promise<ConversationDetail> {
  const c = await db.conversation.findFirst({
    where: { id, businessId, isPreview: false },
    include: {
      ...summaryInclude,
      messages: { orderBy: [{ createdAt: "asc" }, { role: "asc" }] },
    },
  });
  if (!c) throw new ApiError(404, "not_found", "Conversation not found");
  const userTexts = c.messages.filter((m) => m.role === "USER").map((m) => m.content);
  return {
    id: c.id,
    startedAt: c.startedAt.toISOString(),
    lastMessageAt: c.lastMessageAt.toISOString(),
    userMessages: c.userMessageCount,
    preview: preview(userTexts[0] ?? ""),
    language: conversationLanguage(userTexts),
    originDomain: c.originDomain,
    messages: c.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    handoffs: c.handoffs.map(handoffOut),
  };
}

/**
 * Deletes the business's own conversations; messages, handoffs and their events go with them
 * (cascade). Ids of other businesses are ignored, so the count says what was really deleted.
 * The monthly plan counter is not lowered: those conversations did happen.
 */
export async function deleteConversations(
  db: Db,
  businessId: string,
  ids: string[],
): Promise<{ deleted: number }> {
  const { count } = await db.conversation.deleteMany({
    where: { businessId, isPreview: false, id: { in: [...new Set(ids)] } },
  });
  return { deleted: count };
}
