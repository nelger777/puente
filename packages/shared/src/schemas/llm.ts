import { z } from "zod";
import { LlmHandoffReasonSchema } from "./handoff";

/** What the assistant must return (docs/SPEC.md §5). */
export const LlmOutputSchema = z.object({
  reply: z.string().min(1).max(800),
  handoff: z.boolean(),
  reason: LlmHandoffReasonSchema.nullable(),
  summary: z.string().max(600).default(""),
  wa_message: z.string().max(700).optional(),
  quick_replies: z.array(z.string().max(60)).max(3).default([]),
});
export type LlmOutput = z.infer<typeof LlmOutputSchema>;
