import { z } from "zod";

const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM");

export const BusinessHoursSchema = z
  .object({
    /** 0 = Sunday … 6 = Saturday */
    days: z.array(z.int().min(0).max(6)).max(7),
    from: TimeOfDaySchema,
    to: TimeOfDaySchema,
  })
  .refine((h) => h.from < h.to, { message: "La hora de inicio debe ser anterior a la de cierre" });
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

export const WhatsappNumberSchema = z
  .string()
  .regex(/^\d{8,15}$/, "Solo dígitos, con código de país");

export const BrandColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Formato #RRGGBB");

/** How the assistant and the widget address customers: "tú" or Paraguayan/Rioplatense "vos". */
export const VoiceSchema = z.enum(["tu", "vos"]);
export type Voice = z.infer<typeof VoiceSchema>;

export const SuggestionsSchema = z.array(z.string().trim().min(1).max(60)).max(3);
