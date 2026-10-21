import { z } from "zod";
import { BusinessSettingsSchema, EmailSchema, UserSummarySchema } from "./admin";

// Platform operator only (docs/DECISIONS.md § Empresas): list, create and enter businesses.

export const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Mínimo 3 caracteres")
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Solo minúsculas, números y guiones (ej.: optica-sol)");

/** The minimum to start a business; everything else gets defaults and is edited in Configuración. */
export const BusinessCreateSchema = z.object({
  name: BusinessSettingsSchema.shape.name,
  slug: SlugSchema,
  kind: BusinessSettingsSchema.shape.kind,
  whatsappNumber: BusinessSettingsSchema.shape.whatsappNumber,
  notifyEmail: BusinessSettingsSchema.shape.notifyEmail,
  allowedDomains: BusinessSettingsSchema.shape.allowedDomains,
  adminEmail: EmailSchema,
});
export type BusinessCreate = z.infer<typeof BusinessCreateSchema>;

export const PlatformBusinessSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  kind: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  users: z.int(),
  /** Current month in the business's timezone. */
  conversationsThisMonth: z.int(),
  monthlyConversationQuota: z.int().nullable(),
});
export type PlatformBusiness = z.infer<typeof PlatformBusinessSchema>;

export const PlatformBusinessListSchema = z.object({
  businesses: z.array(PlatformBusinessSchema),
});
export type PlatformBusinessList = z.infer<typeof PlatformBusinessListSchema>;

export const BusinessCreateResponseSchema = z.object({
  business: PlatformBusinessSchema,
  admin: UserSummarySchema,
  /** Shown once to the operator; only its hash is stored. */
  password: z.string(),
});
export type BusinessCreateResponse = z.infer<typeof BusinessCreateResponseSchema>;

/** null = back to the operator's own business. */
export const ActAsSchema = z.object({ businessId: z.string().min(1).nullable() });
export type ActAs = z.infer<typeof ActAsSchema>;
