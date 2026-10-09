import {
  LlmOutputSchema,
  QUICK_REPLIES_MAX,
  QUICK_REPLY_MAX_LENGTH,
  type LlmOutput,
} from "@puente/shared";

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

/**
 * Quick replies are optional buttons: a good answer is never discarded for them. Blank or
 * over-long ones are dropped and only the first QUICK_REPLIES_MAX are kept.
 */
function trimQuickReplies(json: unknown): unknown {
  if (typeof json !== "object" || json === null || !("quick_replies" in json)) return json;
  const { quick_replies: raw } = json;
  if (!Array.isArray(raw)) return json;
  const quickReplies = raw
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter((q) => q.length > 0 && q.length <= QUICK_REPLY_MAX_LENGTH)
    .slice(0, QUICK_REPLIES_MAX);
  return { ...json, quick_replies: quickReplies };
}

export type ParsedLlmOutput = { ok: true; output: LlmOutput } | { ok: false; issue: string };

/**
 * Extracts and validates the assistant JSON, tolerating text or code fences around it.
 * On failure, `issue` says which field broke the schema (field path and Zod code only,
 * never content), so it is safe to log.
 */
export function parseLlmOutputDetailed(text: string): ParsedLlmOutput {
  for (const candidate of candidates(text)) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }
    const result = LlmOutputSchema.safeParse(trimQuickReplies(json));
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path.length ? issue.path.join(".") : "(root)";
      return { ok: false, issue: `${path}: ${issue?.code ?? "invalid"}` };
    }
    const output = result.data;
    if (output.handoff && !output.reason) output.reason = "sin_informacion";
    if (!output.handoff) output.reason = null;
    if (output.wa_message?.trim() === "") delete output.wa_message;
    return { ok: true, output };
  }
  return { ok: false, issue: "invalid json" };
}

export function parseLlmOutput(text: string): LlmOutput | null {
  const parsed = parseLlmOutputDetailed(text);
  return parsed.ok ? parsed.output : null;
}
