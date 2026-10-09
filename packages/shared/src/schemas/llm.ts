import { z } from "zod";
import { LlmHandoffReasonSchema } from "./handoff";

/** Quick-reply buttons the assistant may offer; extra or longer ones are dropped, not fatal. */
export const QUICK_REPLIES_MAX = 3;
export const QUICK_REPLY_MAX_LENGTH = 80;

/** What the assistant must return (docs/SPEC.md §5). */
export const LlmOutputSchema = z.object({
  reply: z.string().min(1).max(800),
  handoff: z.boolean(),
  reason: LlmHandoffReasonSchema.nullable(),
  summary: z.string().max(600).default(""),
  wa_message: z.string().max(700).optional(),
  quick_replies: z.array(z.string().max(QUICK_REPLY_MAX_LENGTH)).max(QUICK_REPLIES_MAX).default([]),
});
export type LlmOutput = z.infer<typeof LlmOutputSchema>;
