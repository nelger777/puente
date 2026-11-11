import { z } from "zod";
import {
  BrandColorSchema,
  BusinessHoursSchema,
  SuggestionsSchema,
  VoiceSchema,
  WhatsappNumberSchema,
} from "./business";
import { HandoffCodeSchema, HandoffReasonSchema, HandoffStatusSchema } from "./handoff";
import { MAX_MESSAGE_LENGTH } from "./widget";

// ---------- Auth ----------

export const UserRoleSchema = z.enum(["ADMIN", "AGENT"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Correo inválido").max(254));

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const PASSWORD_MIN_LENGTH = 10;

/** The signed-in user changes their own password; their other sessions are closed. */
export const PasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Obligatorio").max(200),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Mínimo ${PASSWORD_MIN_LENGTH} caracteres`)
      .max(200, "Máximo 200 caracteres"),
  })
  .refine((p) => p.newPassword !== p.currentPassword, {
    message: "Tiene que ser distinta de la actual",
    path: ["newPassword"],
  });
export type PasswordChange = z.infer<typeof PasswordChangeSchema>;

export const MeResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    role: UserRoleSchema,
    /** Platform operator: may list, create and enter every business. */
    platformAdmin: z.boolean(),
  }),
  business: z.object({ id: z.string(), name: z.string() }),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ---------- Users of a business ----------

export const UserSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  role: UserRoleSchema,
  active: z.boolean(),
  createdAt: z.string(),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const UserListResponseSchema = z.object({ users: z.array(UserSummarySchema) });
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

export const UserCreateSchema = z.object({ email: EmailSchema, role: UserRoleSchema });
export type UserCreate = z.infer<typeof UserCreateSchema>;

export const UserPatchSchema = z
  .object({ role: UserRoleSchema.optional(), active: z.boolean().optional() })
  .refine((p) => p.role !== undefined || p.active !== undefined, { message: "Nada que cambiar" });
export type UserPatch = z.infer<typeof UserPatchSchema>;

export const UserIdParamsSchema = z.object({ id: z.string().regex(/^usr_[a-z0-9]+$/) });

/** The generated password travels once, in this response; only its hash is stored. */
export const UserWithPasswordSchema = z.object({
  user: UserSummarySchema,
  password: z.string(),
});
export type UserWithPassword = z.infer<typeof UserWithPasswordSchema>;

// ---------- Business settings ----------

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const DomainSchema = z
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
  voice: VoiceSchema,
  brandColor: BrandColorSchema,
  whatsappNumber: WhatsappNumberSchema,
  /** Handoffs outside opening hours; null = whatsappNumber at all hours. */
  offHoursWhatsappNumber: WhatsappNumberSchema.nullable().default(null),
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
  avatarUrl: z.string().nullable(),
  llm: z.lazy(() => LlmSummarySchema),
});
export type BusinessResponse = z.infer<typeof BusinessResponseSchema>;

// ---------- AI engine per business ----------

/** "default" = the server's key (Claude); "claude" / "gemini" = the business's own key. */
export const LlmProviderSchema = z.enum(["default", "claude", "gemini"]);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const LlmSettingsSchema = z.object({
  provider: LlmProviderSchema,
  /** Write-only: sent once, stored sealed, never returned. Omit to keep the saved one. */
  apiKey: z
    .string()
    .trim()
    .min(20, "Clave incompleta")
    .max(300)
    .regex(/^[A-Za-z0-9._-]+$/, "La clave tiene caracteres inválidos")
    .optional(),
});
export type LlmSettings = z.infer<typeof LlmSettingsSchema>;

export const LlmSummarySchema = z.object({
  provider: LlmProviderSchema,
  hasKey: z.boolean(),
  keyLast4: z.string().nullable(),
});

export const LlmTestResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.int().nullable(),
});
export type LlmTestResponse = z.infer<typeof LlmTestResponseSchema>;

// ---------- Assistant picture ----------

export const AVATAR_MAX_BYTES = 200 * 1024;
/** Animations are stored as uploaded (a canvas would keep only the first frame), so they weigh more. */
export const AVATAR_ANIMATED_MAX_BYTES = 1000 * 1024;
export const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** Upload as a data URL (the panel reads the file in the browser). SVG is never accepted. */
export const AvatarUploadSchema = z.object({
  dataUrl: z
    .string()
    .max(Math.ceil((AVATAR_ANIMATED_MAX_BYTES * 4) / 3) + 64)
    .regex(
      /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/,
      "Imagen PNG, JPG, WebP o GIF",
    ),
});

// ---------- Knowledge base ----------

export const KnowledgeItemInputSchema = z.object({
  question: text(300),
  answer: text(2000),
});
export type KnowledgeItemInput = z.infer<typeof KnowledgeItemInputSchema>;

export const KNOWLEDGE_MAX_ITEMS = 200;

export const KnowledgePutSchema = z.object({
  items: z.array(KnowledgeItemInputSchema).max(KNOWLEDGE_MAX_ITEMS),
});

export const KnowledgeResponseSchema = z.object({
  items: z.array(KnowledgeItemInputSchema.extend({ id: z.string(), position: z.int() })),
});
export type KnowledgeResponse = z.infer<typeof KnowledgeResponseSchema>;

// ---------- Unanswered questions (NO_INFORMATION handoffs not yet reviewed) ----------

export const UnansweredQuestionSchema = z.object({
  /** The customer's own words, in their language. */
  question: z.string(),
  /** The team summary of the latest case, in Spanish. */
  summary: z.string(),
  /** Cases that asked the same thing; reviewing the group reviews all of them. */
  codes: z.array(HandoffCodeSchema).min(1),
  lastAt: z.iso.datetime(),
});
export type UnansweredQuestion = z.infer<typeof UnansweredQuestionSchema>;

export const UnansweredListResponseSchema = z.object({
  items: z.array(UnansweredQuestionSchema),
});
export type UnansweredListResponse = z.infer<typeof UnansweredListResponseSchema>;

export const UnansweredDismissSchema = z.object({
  codes: z.array(HandoffCodeSchema).min(1).max(200),
});
export type UnansweredDismiss = z.infer<typeof UnansweredDismissSchema>;

export const UnansweredAddSchema = UnansweredDismissSchema.extend({
  item: KnowledgeItemInputSchema,
});
export type UnansweredAdd = z.infer<typeof UnansweredAddSchema>;

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

// ---------- Conversations ----------

export const CustomerLanguageSchema = z.enum(["es", "en", "ja"]);
export type CustomerLanguage = z.infer<typeof CustomerLanguageSchema>;

export const ConversationOutcomeSchema = z.enum(["resolved", "handed_off"]);
export type ConversationOutcome = z.infer<typeof ConversationOutcomeSchema>;

export const ConversationIdSchema = z.string().regex(/^conv_[a-z0-9]+$/);
export const ConversationIdParamsSchema = z.object({ id: ConversationIdSchema });

export const ConversationListQuerySchema = z.object({
  outcome: ConversationOutcomeSchema.optional(),
  /** Local days of the business, on the conversation's start. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Text in any message of the conversation, or a case code. */
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().max(64).optional(),
});
export type ConversationListQuery = z.infer<typeof ConversationListQuerySchema>;

const ConversationHandoffSchema = z.object({
  code: HandoffCodeSchema,
  reason: HandoffReasonSchema,
  status: HandoffStatusSchema,
  createdAt: z.iso.datetime(),
});

export const ConversationSummarySchema = z.object({
  id: ConversationIdSchema,
  startedAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime(),
  userMessages: z.int(),
  /** The customer's first message, shortened. */
  preview: z.string(),
  /** Detected from the customer's messages; null when they do not tell. */
  language: CustomerLanguageSchema.nullable(),
  /** The latest handoff; null = resolved by the assistant. */
  handoff: ConversationHandoffSchema.nullable(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ConversationListResponseSchema = z.object({
  items: z.array(ConversationSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;

export const ConversationDetailSchema = ConversationSummarySchema.omit({ handoff: true }).extend({
  originDomain: z.string(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["USER", "ASSISTANT", "SYSTEM"]),
      content: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
  handoffs: z.array(ConversationHandoffSchema),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

export const CONVERSATION_DELETE_MAX = 100;

/** Deletes the conversations with their messages and handoffs; cannot be undone. */
export const ConversationDeleteSchema = z.object({
  ids: z.array(ConversationIdSchema).min(1).max(CONVERSATION_DELETE_MAX),
});
export type ConversationDelete = z.infer<typeof ConversationDeleteSchema>;

export const ConversationDeleteResponseSchema = z.object({ deleted: z.int() });
export type ConversationDeleteResponse = z.infer<typeof ConversationDeleteResponseSchema>;

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
  tokens: z.object({
    input: z.int(),
    output: z.int(),
    llmCalls: z.int(),
    /** Estimate from the configured per-token prices (USD). */
    estimatedCostUsd: z.number().nonnegative(),
    costPerConversationUsd: z.number().nonnegative(),
  }),
  llm: z.object({
    /** Replies where the LLM failed and the customer was handed off. */
    failures: z.object({ timeout: z.int(), api_error: z.int(), invalid_output: z.int() }),
    failureRate: z.number().min(0).max(1),
    avgLatencyMs: z.number().nullable(),
  }),
  pendingCount: z.int(),
  recentPending: z.array(HandoffSummarySchema),
  /** Current month in the business timezone, whatever the range; quota null = no plan cap. */
  usage: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    conversations: z.int(),
    quota: z.int().nullable(),
  }),
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
