import { z } from "zod";
import {
  BrandColorSchema,
  BusinessHoursSchema,
  SuggestionsSchema,
  WhatsappNumberSchema,
} from "./business";
import { HandoffCodeSchema, HandoffReasonSchema, HandoffStatusSchema } from "./handoff";
import { MAX_MESSAGE_LENGTH } from "./widget";

// ---------- Auth ----------

export const UserRoleSchema = z.enum(["ADMIN", "AGENT"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const MeResponseSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), role: UserRoleSchema }),
  business: z.object({ id: z.string(), name: z.string() }),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ---------- Business settings ----------

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const DomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, "Dominio inválido (ej.: tienda.com)");

const text = (max: number) => z.string().trim().min(1, "Obligatorio").max(max);

/** Fields an ADMIN can edit from the panel (docs/SPEC.md §7). */
export const BusinessSettingsSchema = z.object({
  name: text(80),
  kind: text(60),
  botName: text(40),
  brandColor: BrandColorSchema,
  whatsappNumber: WhatsappNumberSchema,
  notifyEmail: z.email("Correo inválido").max(254),
  timezone: z.string().refine(isValidTimeZone, "Zona horaria inválida"),
  hours: BusinessHoursSchema,
  offHoursMessage: text(300),
  greeting: text(300),
  suggestions: SuggestionsSchema,
  sensitiveTopics: z.array(text(60)).max(30),
  allowedDomains: z.array(DomainSchema).max(20),
  maxMessagesPerConv: z.int().min(1).max(100),
  dailyMessageCap: z.int().min(1).max(100_000),
  active: z.boolean(),
});
export type BusinessSettings = z.infer<typeof BusinessSettingsSchema>;

export const BusinessResponseSchema = BusinessSettingsSchema.extend({
  id: z.string(),
  slug: z.string(),
  publicKey: z.string(),
  /** Where the widget bundle is served, for the install snippet. */
  widgetScriptUrl: z.string(),
});
export type BusinessResponse = z.infer<typeof BusinessResponseSchema>;

// ---------- Knowledge base ----------

export const KnowledgeItemInputSchema = z.object({
  question: text(300),
  answer: text(2000),
});
export type KnowledgeItemInput = z.infer<typeof KnowledgeItemInputSchema>;

export const KnowledgePutSchema = z.object({
  items: z.array(KnowledgeItemInputSchema).max(200),
});

export const KnowledgeResponseSchema = z.object({
  items: z.array(KnowledgeItemInputSchema.extend({ id: z.string(), position: z.int() })),
});
export type KnowledgeResponse = z.infer<typeof KnowledgeResponseSchema>;

/** The panel meter: ~1 token per 4 characters (docs/SPEC.md §7). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
export const KNOWLEDGE_TOKEN_WARNING = 20_000;

// ---------- Handoffs ----------

export const HandoffListQuerySchema = z.object({
  status: HandoffStatusSchema.optional(),
  cursor: z.string().max(64).optional(),
});

const IsoDate = z.iso.datetime();

export const HandoffEventSchema = z.object({
  type: z.string(),
  actor: z.string(),
  createdAt: IsoDate,
});

export const HandoffSummarySchema = z.object({
  code: HandoffCodeSchema,
  reason: HandoffReasonSchema,
  status: HandoffStatusSchema,
  createdAt: IsoDate,
  openedInHours: z.boolean(),
  summary: z.string(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  lastEvent: HandoffEventSchema.nullable(),
});
export type HandoffSummary = z.infer<typeof HandoffSummarySchema>;

export const HandoffListResponseSchema = z.object({
  items: z.array(HandoffSummarySchema),
  nextCursor: z.string().nullable(),
  pendingCount: z.int(),
});
export type HandoffListResponse = z.infer<typeof HandoffListResponseSchema>;

export const HandoffDetailSchema = HandoffSummarySchema.extend({
  waMessage: z.string(),
  resolvedAt: IsoDate.nullable(),
  conversation: z.object({
    id: z.string(),
    startedAt: IsoDate,
    originDomain: z.string(),
  }),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["USER", "ASSISTANT", "SYSTEM"]),
      content: z.string(),
      createdAt: IsoDate,
    }),
  ),
  events: z.array(HandoffEventSchema),
});
export type HandoffDetail = z.infer<typeof HandoffDetailSchema>;

export const HandoffPatchSchema = z.object({ status: HandoffStatusSchema });

// ---------- Metrics ----------

export const MetricsQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const MetricsResponseSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  conversations: z.int(),
  userMessages: z.int(),
  /** Conversations with at least one customer message and no handoff. */
  resolvedByAssistant: z.int(),
  handedOff: z.int(),
  /** resolvedByAssistant / conversations, 0 when there are none. */
  resolutionRate: z.number().min(0).max(1),
  handoffsByReason: z.record(HandoffReasonSchema, z.int()),
  tokens: z.object({ input: z.int(), output: z.int(), llmCalls: z.int() }),
  pendingCount: z.int(),
  recentPending: z.array(HandoffSummarySchema),
});
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

// ---------- Preview chat ("Probar") ----------

export const PreviewChatRequestSchema = z.object({
  conversationId: z.string().max(64).nullish(),
  conversationToken: z.string().min(16).max(128).nullish(),
  visitorId: z.string().trim().min(1).max(64).default("v_preview"),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});
export type PreviewChatRequest = z.infer<typeof PreviewChatRequestSchema>;
