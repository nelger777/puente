import {
  LLM_REASON_TO_HANDOFF_REASON,
  type ChatRequest,
  type ChatResponse,
  type HandoffReason,
} from "@puente/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client";
import type { Business, Conversation } from "../generated/prisma/client";
import { newId } from "../lib/ids";
import { isInHours } from "../lib/time";
import type { Notifier } from "../services/notifications";
import type { UsageMeter } from "../services/usage";
import { businessHours, businessVoice, handoffNumber } from "./business";
import { loadOrCreateConversation } from "./conversation";
import {
  fallbackWaMessage,
  ruleSummary,
  sanitizeWaMessage,
  upsertPendingHandoff,
  waText,
  waUrl,
  type HandoffTexts,
} from "./handoff";
import type { LlmRouter } from "../services/llm-router";
import { conversationLanguage, type CustomerLanguage } from "./language";
import { callLlm, type LlmFailure } from "./llm";
import { preRules } from "./pre-rules";
import { buildHistory, buildSystemPrompt, HISTORY_LIMIT } from "./prompt";
import { checkRateLimits, type IpRateLimiter } from "./rate-limits";

export const REPLIES = {
  limit:
    "Llegamos al límite de mensajes de esta conversación. Para no dejarte sin respuesta, te conecto con una persona del equipo.",
  limitAlreadyHandedOff:
    "Ya derivé tu consulta al equipo. Toca el botón de WhatsApp para seguir con una persona.",
  technicalFailure:
    "En este momento no puedo responder, pero te conecto con el equipo para que no pierdas tu consulta.",
} as const;

/** The only fixed reply that changes with "vos" (the rest reads the same). */
export const REPLIES_VOS = {
  ...REPLIES,
  limitAlreadyHandedOff:
    "Ya derivé tu consulta al equipo. Tocá el botón de WhatsApp para seguir con una persona.",
} as const;

export const REPLIES_EN = {
  limit:
    "We've reached the message limit for this conversation. So you're not left without an answer, I'm connecting you with someone from our team.",
  limitAlreadyHandedOff:
    "I've already passed your question to our team. Tap the WhatsApp button to continue with a person.",
  technicalFailure:
    "I can't answer right now, but I'm connecting you with our team so your question isn't lost.",
} as const;

export const REPLIES_JA = {
  limit:
    "この会話のメッセージ上限に達しました。お答えできないままにならないよう、担当者におつなぎします。",
  limitAlreadyHandedOff:
    "お問い合わせはすでに担当者に引き継ぎました。WhatsAppのボタンを押して、担当者とお話しください。",
  technicalFailure:
    "ただいまお答えできませんが、お問い合わせが失われないよう担当者におつなぎします。",
} as const;

function fixedReplies(business: Business, language: CustomerLanguage | null) {
  if (language === "en") return REPLIES_EN;
  if (language === "ja") return REPLIES_JA;
  return businessVoice(business) === "vos" ? REPLIES_VOS : REPLIES;
}

export interface EngineDeps {
  db: Db;
  /** The engine (and key) of each business: its own, or the server default. */
  llmFor: LlmRouter;
  llmTimeoutMs: number;
  limiter: IpRateLimiter;
  notifier: Notifier;
  /** Monthly conversation count and plan alerts. */
  usage: UsageMeter;
  /** Our own app origins, never allowed inside the customer's WhatsApp text. */
  internalOrigins: string[];
  now: () => Date;
}

export interface ChatContext {
  ip: string;
  log: FastifyBaseLogger;
  /** Step 1 (resolveBusiness) runs in the route, which needs it to answer CORS. */
  business: Business;
  originHost: string;
  /** Panel "Probar": no origin check, no e-mails, excluded from inbox and metrics. */
  isPreview?: boolean;
}

interface AssistantStats {
  engine: "llm" | "rules";
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  llmError?: LlmFailure;
}

/** POST /v1/chat pipeline (docs/SPEC.md §5). Always answers; failures become handoffs. */
export async function handleChat(
  deps: EngineDeps,
  input: Omit<ChatRequest, "key">,
  ctx: ChatContext,
): Promise<ChatResponse> {
  const { db } = deps;
  const now = deps.now();

  const { business, originHost } = ctx;

  // 2–3
  await checkRateLimits(db, deps.limiter, ctx.ip, business, now);
  const { conversation, token } = await loadOrCreateConversation(db, business, {
    conversationId: input.conversationId,
    conversationToken: input.conversationToken,
    visitorId: input.visitorId,
    originHost,
    isPreview: ctx.isPreview ?? false,
  });

  // 4–5: store the message and count it atomically; over the limit → hand off without the LLM.
  const [, counted] = await db.$transaction([
    db.message.create({
      data: {
        id: newId("msg"),
        conversationId: conversation.id,
        role: "USER",
        content: input.message,
      },
    }),
    db.conversation.update({
      where: { id: conversation.id },
      data: { userMessageCount: { increment: 1 }, lastMessageAt: now },
    }),
  ]);
  // A conversation counts for the monthly plan once, on its first customer message.
  if (counted.userMessageCount === 1 && !conversation.isPreview) {
    deps.usage.conversationStarted(business, now);
  }
  const remainingMessages = Math.max(0, business.maxMessagesPerConv - counted.userMessageCount);
  const inHours = isInHours(businessHours(business), business.timezone, now);

  const history = (
    await db.message.findMany({
      where: { conversationId: conversation.id },
      // role desc breaks same-millisecond ties so the reply sorts after the question.
      orderBy: [{ createdAt: "desc" }, { role: "desc" }],
      take: HISTORY_LIMIT,
    })
  ).reverse();
  const userMessages = history.filter((m) => m.role === "USER").map((m) => m.content);
  const language = conversationLanguage(userMessages);
  const replies = fixedReplies(business, language);

  const turn: Turn = {
    deps,
    business,
    conversation,
    token,
    inHours,
    remainingMessages,
    userMessages,
    isPreview: conversation.isPreview,
  };

  if (counted.userMessageCount > business.maxMessagesPerConv) {
    return finishWithHandoff(turn, "LIMIT", null, { engine: "rules" }, (created) =>
      created ? replies.limit : replies.limitAlreadyHandedOff,
    );
  }

  // 6
  const rule = preRules(input.message, business.sensitiveTopics, language ?? "es");
  if (rule) {
    return finishWithHandoff(turn, rule.reason, null, { engine: "rules" }, () => rule.reply);
  }

  // 7–8
  const knowledge = await db.knowledgeItem.findMany({
    where: { businessId: business.id },
    orderBy: { position: "asc" },
    select: { question: true, answer: true },
  });
  const route = deps.llmFor(business);
  const result = await callLlm(
    route.transport,
    { model: route.model, timeoutMs: deps.llmTimeoutMs },
    buildSystemPrompt(business, knowledge, language),
    buildHistory(history),
  );
  if (!result.ok) {
    ctx.log.warn(
      {
        conversationId: conversation.id,
        provider: route.provider,
        failure: result.failure,
        detail: result.detail,
        latencyMs: result.latencyMs,
      },
      "llm call failed, handing off",
    );
    return finishWithHandoff(
      turn,
      "TECHNICAL_FAILURE",
      null,
      {
        engine: "rules",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        llmError: result.failure,
      },
      () => replies.technicalFailure,
    );
  }

  const { output } = result;
  const stats: AssistantStats = {
    engine: "llm",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
  };

  // 9
  if (output.handoff) {
    const reason = LLM_REASON_TO_HANDOFF_REASON[output.reason ?? "sin_informacion"];
    const summary = output.summary.trim() || ruleSummary(reason, userMessages);
    const waMessage =
      sanitizeWaMessage(output.wa_message ?? "", deps.internalOrigins) ||
      fallbackWaMessage(business.name, userMessages);
    return finishWithHandoff(turn, reason, { summary, waMessage }, stats, () => output.reply);
  }

  // 10
  await saveAssistantMessage(db, conversation.id, output.reply, stats);
  return {
    conversationId: conversation.id,
    conversationToken: token,
    reply: output.reply,
    quickReplies: output.quick_replies,
    remainingMessages,
    handoff: null,
  };
}

interface Turn {
  deps: EngineDeps;
  business: Business;
  conversation: Conversation;
  token: string;
  inHours: boolean;
  remainingMessages: number;
  userMessages: string[];
  isPreview: boolean;
}

async function finishWithHandoff(
  turn: Turn,
  reason: HandoffReason,
  modelTexts: HandoffTexts | null,
  stats: AssistantStats,
  replyFor: (created: boolean) => string,
): Promise<ChatResponse> {
  const { deps, business, conversation, userMessages } = turn;

  const { handoff, created } = await upsertPendingHandoff(deps.db, {
    business,
    conversation,
    reason,
    initialTexts: modelTexts ?? {
      summary: ruleSummary(reason, userMessages),
      waMessage: fallbackWaMessage(business.name, userMessages),
    },
    updateTexts: modelTexts,
    inHours: turn.inHours,
  });
  if (created && !turn.isPreview) deps.notifier.handoffCreated(business, handoff);

  const reply = replyFor(created);
  await saveAssistantMessage(deps.db, conversation.id, reply, stats);

  return {
    conversationId: conversation.id,
    conversationToken: turn.token,
    reply,
    quickReplies: [],
    remainingMessages: turn.remainingMessages,
    handoff: {
      code: handoff.code,
      reason: handoff.reason,
      waMessage: handoff.waMessage,
      waUrl: waUrl(handoffNumber(business, turn.inHours), waText(handoff.waMessage, handoff.code)),
      inHours: turn.inHours,
      offHoursMessage: turn.inHours ? null : business.offHoursMessage,
    },
  };
}

async function saveAssistantMessage(
  db: Db,
  conversationId: string,
  content: string,
  stats: AssistantStats,
): Promise<void> {
  await db.message.create({
    data: {
      id: newId("msg"),
      conversationId,
      role: "ASSISTANT",
      content,
      engine: stats.engine,
      inputTokens: stats.inputTokens ?? null,
      outputTokens: stats.outputTokens ?? null,
      latencyMs: stats.latencyMs ?? null,
      llmError: stats.llmError ?? null,
    },
  });
}
