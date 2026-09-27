import { LlmOutputSchema, type LlmOutput } from "@puente/shared";

/**
 * JSON schema sent as structured output. Length limits are not supported by the API,
 * so LlmOutputSchema (Zod) still validates them afterwards.
 */
export const LLM_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    handoff: { type: "boolean" },
    reason: {
      anyOf: [
        {
          type: "string",
          enum: [
            "pedido_explicito",
            "sin_informacion",
            "tema_sensible",
            "frustracion",
            "repeticion",
          ],
        },
        { type: "null" },
      ],
    },
    summary: { type: "string" },
    wa_message: { type: "string" },
    quick_replies: { type: "array", items: { type: "string" } },
  },
  required: ["reply", "handoff", "reason", "summary", "wa_message", "quick_replies"],
  additionalProperties: false,
};

const FENCED_BLOCK = /```(?:json)?\s*([\s\S]*?)```/i;

function candidates(text: string): string[] {
  const trimmed = text.trim();
  const list = [trimmed];
  const fenced = FENCED_BLOCK.exec(trimmed);
  if (fenced?.[1]) list.push(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) list.push(trimmed.slice(start, end + 1));
  return list;
}

/** Extracts and validates the assistant JSON, tolerating text or code fences around it. */
export function parseLlmOutput(text: string): LlmOutput | null {
  for (const candidate of candidates(text)) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }
    const result = LlmOutputSchema.safeParse(json);
    if (!result.success) return null;
    const output = result.data;
    if (output.handoff && !output.reason) output.reason = "sin_informacion";
    if (!output.handoff) output.reason = null;
    if (output.wa_message?.trim() === "") delete output.wa_message;
    return output;
  }
  return null;
}
