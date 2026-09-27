import { randomInt } from "node:crypto";
import { HANDOFF_REASON_LABELS, type HandoffReason } from "@puente/shared";
import type { Db } from "../db/client";
import { Prisma, type Business, type Conversation, type Handoff } from "../generated/prisma/client";
import { newId } from "../lib/ids";
import { tokenMatches } from "../lib/tokens";
import { isExplicitHumanRequest } from "./pre-rules";

/** DER- + 4 digits; longer codes only after repeated collisions. */
export function newHandoffCode(attempt: number): string {
  const digits = attempt < 3 ? 4 : attempt < 5 ? 5 : 6;
  return `DER-${randomInt(10 ** (digits - 1), 10 ** digits)}`;
}

/** Spec fallback when the model gave no wa_message (or there was no model call). */
export function fallbackWaMessage(businessName: string, userMessages: string[]): string {
  const relevant = userMessages.filter((m) => !isExplicitHumanRequest(m)).slice(-3);
  if (relevant.length === 0) {
    return `Hola ${businessName}, vengo de su asistente virtual y quisiera hablar con una persona del equipo.`;
  }
  // Keep the customer's punctuation; close each message with a period if it has none.
  const consulta = relevant.map((m) => m.trim().replace(/([^.?!])$/, "$1.")).join(" ");
  return `Hola ${businessName}, estuve consultando con su asistente virtual. Mi consulta es: ${consulta} ¿Me pueden ayudar?`;
}

export function ruleSummary(reason: HandoffReason, userMessages: string[]): string {
  const last = userMessages
    .slice(-3)
    .map((m) => `"${m.trim()}"`)
    .join(" / ");
  return `Derivación automática (${HANDOFF_REASON_LABELS[reason]}). Últimos mensajes del cliente: ${last}.`;
}

/** The customer sees this text: strip any link that points to our own apps. */
export function sanitizeWaMessage(text: string, internalOrigins: string[]): string {
  let clean = text;
  for (const origin of internalOrigins) {
    const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    clean = clean.replace(new RegExp(`${escaped}\\S*`, "gi"), "");
  }
  return clean.replace(/[ \t]{2,}/g, " ").trim();
}

export function waText(waMessage: string, code: string): string {
  return `${waMessage}\n\n(Caso ${code})`;
}

export function waUrl(whatsappNumber: string, text: string): string {
  return `https://wa.me/${whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export interface HandoffTexts {
  summary: string;
  waMessage: string;
}

export interface UpsertHandoffInput {
  business: Pick<Business, "id">;
  conversation: Pick<Conversation, "id">;
  reason: HandoffReason;
  /** Texts for a new case. */
  initialTexts: HandoffTexts;
  /** Texts that replace the pending case's; null keeps the existing ones (rule/server reasons). */
  updateTexts: HandoffTexts | null;
  inHours: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * One pending handoff per conversation: creates it, or updates the existing one keeping its
 * original reason (docs/DECISIONS.md). The conversation row is locked so concurrent
 * messages cannot create two cases.
 */
export async function upsertPendingHandoff(
  db: Db,
  input: UpsertHandoffInput,
): Promise<{ handoff: Handoff; created: boolean }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${input.conversation.id} FOR UPDATE`;
        await tx.conversation.update({
          where: { id: input.conversation.id },
          data: { status: "HANDED_OFF" },
        });

        const pending = await tx.handoff.findFirst({
          where: {
            businessId: input.business.id,
            conversationId: input.conversation.id,
            status: "PENDING",
          },
        });

        if (pending) {
          const handoff = await tx.handoff.update({
            where: { id: pending.id },
            data: input.updateTexts ?? {},
          });
          await tx.handoffEvent.create({
            data: { id: newId("hev"), handoffId: pending.id, type: "updated", actor: "system" },
          });
          return { handoff, created: false };
        }

        const handoff = await tx.handoff.create({
          data: {
            id: newId("hof"),
            code: newHandoffCode(attempt),
            businessId: input.business.id,
            conversationId: input.conversation.id,
            reason: input.reason,
            summary: input.initialTexts.summary,
            waMessage: input.initialTexts.waMessage,
            openedInHours: input.inHours,
          },
        });
        await tx.handoffEvent.create({
          data: { id: newId("hev"), handoffId: handoff.id, type: "created", actor: "system" },
        });
        return { handoff, created: true };
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 8) continue;
      throw err;
    }
  }
}

/** Handoff of this business whose conversation token matches (widget-side actions). */
export async function findHandoffForCustomer(
  db: Db,
  businessId: string,
  code: string,
  conversationToken: string,
): Promise<{ handoff: Handoff; isPreview: boolean } | null> {
  const found = await db.handoff.findFirst({
    where: { code, businessId },
    include: { conversation: { select: { tokenHash: true, isPreview: true } } },
  });
  if (!found || !tokenMatches(conversationToken, found.conversation.tokenHash)) return null;
  const { conversation, ...handoff } = found;
  return { handoff, isPreview: conversation.isPreview };
}
