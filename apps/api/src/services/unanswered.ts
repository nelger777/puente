import {
  KNOWLEDGE_MAX_ITEMS,
  type KnowledgeItemInput,
  type KnowledgeResponse,
  type UnansweredListResponse,
  type UnansweredQuestion,
} from "@puente/shared";
import type { Db } from "../db/client";
import { ApiError } from "../lib/errors";
import { newId } from "../lib/ids";
import { listKnowledge } from "./admin";

/** Handoff events that take a case out of "Sin respuesta". */
export const KNOWLEDGE_ADDED = "knowledge_added";
export const KNOWLEDGE_DISMISSED = "knowledge_dismissed";

const LIST_LIMIT = 200;

/** Same question with different case or punctuation ("¿Cubren granizo?" / "cubren granizo"). */
export function questionKey(question: string): string {
  return question
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

/**
 * Real NO_INFORMATION handoffs nobody has reviewed yet, grouped by the customer's question
 * (the last message they wrote before the handoff), newest first.
 */
export async function listUnanswered(db: Db, businessId: string): Promise<UnansweredListResponse> {
  const rows = await db.handoff.findMany({
    where: {
      businessId,
      reason: "NO_INFORMATION",
      conversation: { isPreview: false },
      events: { none: { type: { in: [KNOWLEDGE_ADDED, KNOWLEDGE_DISMISSED] } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIST_LIMIT,
    include: {
      conversation: {
        select: {
          messages: {
            where: { role: "USER" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 20,
            select: { content: true, createdAt: true },
          },
        },
      },
    },
  });

  const groups = new Map<string, UnansweredQuestion>();
  for (const h of rows) {
    const asked = h.conversation.messages.find((m) => m.createdAt <= h.createdAt);
    const question = asked?.content ?? h.summary;
    const key = questionKey(question) || h.code;
    const group = groups.get(key);
    if (group) group.codes.push(h.code);
    else {
      groups.set(key, {
        question,
        summary: h.summary,
        codes: [h.code],
        lastAt: h.createdAt.toISOString(),
      });
    }
  }
  return { items: [...groups.values()] };
}

/** Only this business's NO_INFORMATION cases: any other code is a 404 for the whole call. */
async function findCases(db: Db, businessId: string, codes: string[]) {
  const unique = [...new Set(codes)];
  const cases = await db.handoff.findMany({
    where: { businessId, reason: "NO_INFORMATION", code: { in: unique } },
    select: { id: true },
  });
  if (cases.length !== unique.length) {
    throw new ApiError(404, "handoff_not_found", "Handoff not found");
  }
  return cases;
}

function reviewEvents(cases: { id: string }[], type: string, actorUserId: string) {
  return cases.map((c) => ({ id: newId("hev"), handoffId: c.id, type, actor: actorUserId }));
}

export async function dismissUnanswered(
  db: Db,
  businessId: string,
  codes: string[],
  actorUserId: string,
): Promise<void> {
  const cases = await findCases(db, businessId, codes);
  await db.handoffEvent.createMany({
    data: reviewEvents(cases, KNOWLEDGE_DISMISSED, actorUserId),
  });
}

/** Appends the answer to the end of the knowledge base and closes the group, atomically. */
export async function addUnansweredToKnowledge(
  db: Db,
  businessId: string,
  codes: string[],
  item: KnowledgeItemInput,
  actorUserId: string,
): Promise<KnowledgeResponse> {
  const cases = await findCases(db, businessId, codes);
  await db.$transaction(async (tx) => {
    const { _count, _max } = await tx.knowledgeItem.aggregate({
      where: { businessId },
      _count: true,
      _max: { position: true },
    });
    if (_count >= KNOWLEDGE_MAX_ITEMS) {
      throw new ApiError(
        409,
        "knowledge_full",
        `La base ya tiene ${KNOWLEDGE_MAX_ITEMS} preguntas. Quita o une alguna antes de agregar otra.`,
      );
    }
    await tx.knowledgeItem.create({
      data: {
        id: newId("kb"),
        businessId,
        question: item.question,
        answer: item.answer,
        position: (_max.position ?? -1) + 1,
      },
    });
    await tx.handoffEvent.createMany({
      data: reviewEvents(cases, KNOWLEDGE_ADDED, actorUserId),
    });
  });
  return listKnowledge(db, businessId);
}
