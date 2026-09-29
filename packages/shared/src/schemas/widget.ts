import { z } from "zod";
import { VoiceSchema } from "./business";
import { HandoffCodeSchema, HandoffReasonSchema } from "./handoff";

export const PublicKeySchema = z.string().regex(/^pk_[A-Za-z0-9_-]{8,64}$/);

const ConversationTokenSchema = z.string().min(16).max(128);

export const WidgetConfigQuerySchema = z.object({ key: PublicKeySchema });

export const WidgetConfigResponseSchema = z.object({
  businessName: z.string(),
  botName: z.string(),
  voice: VoiceSchema,
  brandColor: z.string(),
  greeting: z.string(),
  suggestions: z.array(z.string()),
  inHours: z.boolean(),
});
export type WidgetConfigResponse = z.infer<typeof WidgetConfigResponseSchema>;

export const MAX_MESSAGE_LENGTH = 1000;

export const ChatRequestSchema = z.object({
  key: PublicKeySchema,
  conversationId: z.string().max(64).nullish(),
  conversationToken: ConversationTokenSchema.nullish(),
  visitorId: z.string().trim().min(1).max(64),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatHandoffSchema = z.object({
  code: HandoffCodeSchema,
  reason: HandoffReasonSchema,
  /** Text shown to the customer as a preview; waUrl carries it plus the case code. */
  waMessage: z.string(),
  waUrl: z.url(),
  inHours: z.boolean(),
  offHoursMessage: z.string().nullable(),
});
export type ChatHandoff = z.infer<typeof ChatHandoffSchema>;

export const ChatResponseSchema = z.object({
  conversationId: z.string(),
  conversationToken: z.string(),
  reply: z.string(),
  quickReplies: z.array(z.string()),
  remainingMessages: z.int().min(0),
  handoff: ChatHandoffSchema.nullable(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const HandoffCodeParamsSchema = z.object({ code: HandoffCodeSchema });

export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s().-]{7,20}$/, "Teléfono inválido")
  .refine((v) => v.replace(/\D/g, "").length >= 7, "Teléfono inválido");

export const HandoffContactRequestSchema = z.object({
  key: PublicKeySchema,
  conversationToken: ConversationTokenSchema,
  name: z.string().trim().max(80).optional(),
  phone: PhoneSchema,
  /** The widget must show the consent text and the customer must accept it. */
  consent: z.literal(true),
});
export type HandoffContactRequest = z.infer<typeof HandoffContactRequestSchema>;

export const HandoffEventRequestSchema = z.object({
  key: PublicKeySchema,
  conversationToken: ConversationTokenSchema,
  type: z.literal("whatsapp_opened"),
});
export type HandoffEventRequest = z.infer<typeof HandoffEventRequestSchema>;
