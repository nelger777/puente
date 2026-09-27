import type { Db } from "../db/client";
import type { Business, Conversation } from "../generated/prisma/client";
import { newId } from "../lib/ids";
import { hashToken, newSecretToken, tokenMatches } from "../lib/tokens";

export interface ConversationInput {
  conversationId?: string | null | undefined;
  conversationToken?: string | null | undefined;
  visitorId: string;
  originHost: string;
  isPreview?: boolean;
}

/**
 * Reuses the conversation only when id, business and token all match;
 * otherwise starts a new one and hands out a fresh token.
 */
export async function loadOrCreateConversation(
  db: Db,
  business: Business,
  input: ConversationInput,
): Promise<{ conversation: Conversation; token: string }> {
  if (input.conversationId && input.conversationToken) {
    const existing = await db.conversation.findFirst({
      where: { id: input.conversationId, businessId: business.id, status: { not: "CLOSED" } },
    });
    if (existing && tokenMatches(input.conversationToken, existing.tokenHash)) {
      return { conversation: existing, token: input.conversationToken };
    }
  }

  const token = newSecretToken();
  const conversation = await db.conversation.create({
    data: {
      id: newId("conv"),
      businessId: business.id,
      tokenHash: hashToken(token),
      visitorId: input.visitorId,
      originDomain: input.originHost,
      isPreview: input.isPreview ?? false,
    },
  });
  return { conversation, token };
}
