import Anthropic from "@anthropic-ai/sdk";
import type { LlmOutput } from "@puente/shared";
import { LLM_OUTPUT_JSON_SCHEMA, parseLlmOutput } from "./llm-output";

// ---------- Provider-neutral contract ----------

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** JSON schema the reply must follow (structured output where the provider supports it). */
  jsonSchema: Record<string, unknown>;
}

export interface LlmReply {
  text: string;
  /** false when the reply was cut (token limit) or refused: its JSON cannot be trusted. */
  complete: boolean;
  inputTokens: number;
  outputTokens: number;
}

/** What callLlm needs to know about a failure: retry it once, or count it as a timeout. */
export class LlmTransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly timeout = false,
  ) {
    super(message);
    this.name = "LlmTransportError";
  }
}

/** Seam over each provider so tests inject a fake (real APIs are never called in CI). */
export interface LlmTransport {
  send(request: LlmRequest, options: { timeout: number; signal: AbortSignal }): Promise<LlmReply>;
}

// ---------- Claude (Anthropic SDK) ----------

/** Maps SDK errors to the retry policy: once on network errors and 5xx, never on timeouts. */
export function fromAnthropicError(err: unknown): LlmTransportError {
  if (
    err instanceof Anthropic.APIConnectionTimeoutError ||
    err instanceof Anthropic.APIUserAbortError
  ) {
    return new LlmTransportError("timeout", false, true);
  }
  if (err instanceof Anthropic.APIConnectionError) return new LlmTransportError("network", true);
  if (err instanceof Anthropic.APIError && typeof err.status === "number") {
    return new LlmTransportError(`http ${err.status}`, err.status >= 500);
  }
  return new LlmTransportError("unknown", false);
}

export function anthropicTransport(apiKey: string): LlmTransport {
  // SDK retries are off: callLlm applies the spec's own retry policy.
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return {
    async send(request, options) {
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(
          {
            model: request.model,
            max_tokens: request.maxTokens,
            system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
            messages: request.messages,
            output_config: { format: { type: "json_schema", schema: request.jsonSchema } },
          },
          { timeout: options.timeout, signal: options.signal, maxRetries: 0 },
        );
      } catch (err) {
        throw fromAnthropicError(err);
      }
      const usage = message.usage;
      return {
        text: message.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
        complete: message.stop_reason === "end_turn",
        inputTokens:
          usage.input_tokens +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
      };
    },
  };
}

// ---------- Gemini (OpenAI-compatible REST endpoint) ----------

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";

interface ChatCompletion {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Gemini through its OpenAI-compatible API, with plain fetch (no extra dependency). Asks for
 * the JSON schema; if the endpoint rejects that format, retries once asking only for JSON
 * (the reply is validated with Zod either way). Rate limits (429) are not retried.
 */
export function geminiTransport(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl = GEMINI_BASE_URL,
): LlmTransport {
  async function post(body: object, signal: AbortSignal): Promise<Response> {
    try {
      return await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        throw new LlmTransportError("timeout", false, true);
      }
      throw new LlmTransportError("network", true);
    }
  }

  return {
    async send(request, options) {
      const base = {
        model: request.model,
        max_tokens: request.maxTokens,
        reasoning_effort: "low",
        messages: [{ role: "system", content: request.system }, ...request.messages],
      };
      let res = await post(
        {
          ...base,
          response_format: {
            type: "json_schema",
            json_schema: { name: "reply", strict: true, schema: request.jsonSchema },
          },
        },
        options.signal,
      );
      if (res.status === 400) {
        res = await post({ ...base, response_format: { type: "json_object" } }, options.signal);
      }
      if (!res.ok) throw new LlmTransportError(`http ${res.status}`, res.status >= 500);

      let json: ChatCompletion;
      try {
        json = (await res.json()) as ChatCompletion;
      } catch {
        throw new LlmTransportError("bad response", true);
      }
      const choice = json.choices?.[0];
      return {
        text: choice?.message?.content ?? "",
        complete: choice?.finish_reason === "stop",
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      };
    },
  };
}

// ---------- The call with deadline and retry ----------

export interface LlmConfig {
  model: string;
  timeoutMs: number;
}

export type LlmFailure = "timeout" | "api_error" | "invalid_output";

export type LlmResult =
  | { ok: true; output: LlmOutput; inputTokens: number; outputTokens: number; latencyMs: number }
  | {
      ok: false;
      failure: LlmFailure;
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number;
    };

class DeadlineExceeded extends Error {}

/**
 * Calls the model within one overall deadline (LLM_TIMEOUT_MS), with at most one retry.
 * Never throws: failures come back as { ok: false } so the pipeline can hand off.
 */
export async function callLlm(
  transport: LlmTransport,
  config: LlmConfig,
  system: string,
  messages: LlmMessage[],
): Promise<LlmResult> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Set before aborting: abort() makes the in-flight call reject synchronously, and that
  // rejection must still be classified as a timeout.
  let timedOut = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new DeadlineExceeded());
      controller.abort();
    }, config.timeoutMs);
  });
  deadline.catch(() => undefined);

  const request: LlmRequest = {
    model: config.model,
    system,
    messages,
    maxTokens: 2048,
    jsonSchema: LLM_OUTPUT_JSON_SCHEMA,
  };

  const attempt = () => {
    const remaining = Math.max(1, config.timeoutMs - (Date.now() - started));
    return Promise.race([
      transport.send(request, { timeout: remaining, signal: controller.signal }),
      deadline,
    ]);
  };
  const retryable = (err: unknown) => err instanceof LlmTransportError && err.retryable;

  let reply: LlmReply;
  try {
    try {
      reply = await attempt();
    } catch (err) {
      if (timedOut || !retryable(err)) throw err;
      reply = await attempt();
    }
  } catch (err) {
    const timeout =
      timedOut ||
      err instanceof DeadlineExceeded ||
      (err instanceof LlmTransportError && err.timeout);
    return {
      ok: false,
      failure: timeout ? "timeout" : "api_error",
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - started;
  const { inputTokens, outputTokens } = reply;
  // Cut or refused: the JSON may be incomplete or off-schema, so treat it as a failure.
  const output = reply.complete ? parseLlmOutput(reply.text) : null;
  if (!output) {
    return { ok: false, failure: "invalid_output", inputTokens, outputTokens, latencyMs };
  }
  return { ok: true, output, inputTokens, outputTokens, latencyMs };
}
