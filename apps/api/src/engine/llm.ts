import Anthropic from "@anthropic-ai/sdk";
import type { LlmOutput } from "@puente/shared";
import { LLM_OUTPUT_JSON_SCHEMA, parseLlmOutput } from "./llm-output";

/** Thin seam over the SDK so tests inject a fake (the real API is never called in CI). */
export interface LlmTransport {
  send(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options: { timeout: number; signal: AbortSignal },
  ): Promise<Anthropic.Message>;
}

export function anthropicTransport(apiKey: string): LlmTransport {
  // SDK retries are off: callLlm applies the spec's own retry policy.
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return {
    send: (params, options) =>
      client.messages.create(params, {
        timeout: options.timeout,
        signal: options.signal,
        maxRetries: 0,
      }),
  };
}

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

function isTimeout(err: unknown): boolean {
  return (
    err instanceof DeadlineExceeded ||
    err instanceof Anthropic.APIConnectionTimeoutError ||
    err instanceof Anthropic.APIUserAbortError
  );
}

/** Retry once only on network errors (not timeouts) and 5xx. */
function isRetryable(err: unknown): boolean {
  if (isTimeout(err)) return false;
  if (err instanceof Anthropic.APIConnectionError) return true;
  return err instanceof Anthropic.APIError && typeof err.status === "number" && err.status >= 500;
}

/**
 * Calls the model within one overall deadline (LLM_TIMEOUT_MS), with at most one retry.
 * Never throws: failures come back as { ok: false } so the pipeline can hand off.
 */
export async function callLlm(
  transport: LlmTransport,
  config: LlmConfig,
  system: string,
  messages: Anthropic.MessageParam[],
): Promise<LlmResult> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DeadlineExceeded());
    }, config.timeoutMs);
  });
  deadline.catch(() => undefined);

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.model,
    max_tokens: 2048,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
    output_config: { format: { type: "json_schema", schema: LLM_OUTPUT_JSON_SCHEMA } },
  };

  const attempt = () => {
    const remaining = Math.max(1, config.timeoutMs - (Date.now() - started));
    return Promise.race([
      transport.send(params, { timeout: remaining, signal: controller.signal }),
      deadline,
    ]);
  };

  let message: Anthropic.Message;
  try {
    try {
      message = await attempt();
    } catch (err) {
      if (!isRetryable(err)) throw err;
      message = await attempt();
    }
  } catch (err) {
    return {
      ok: false,
      failure: isTimeout(err) ? "timeout" : "api_error",
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - started;
  const usage = message.usage;
  const inputTokens =
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
  const outputTokens = usage.output_tokens;

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  // max_tokens or refusal: the JSON may be cut or off-schema, so treat it as a failure.
  const output = message.stop_reason === "end_turn" ? parseLlmOutput(text) : null;
  if (!output) {
    return { ok: false, failure: "invalid_output", inputTokens, outputTokens, latencyMs };
  }
  return { ok: true, output, inputTokens, outputTokens, latencyMs };
}
