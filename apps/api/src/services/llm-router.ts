import { LlmProviderSchema, type LlmProvider } from "@puente/shared";
import type { Business } from "../generated/prisma/client";
import { anthropicTransport, geminiTransport, type LlmTransport } from "../engine/llm";
import type { SecretBox } from "../lib/secrets";

export interface LlmRoute {
  transport: LlmTransport;
  model: string;
  provider: LlmProvider;
}

export type LlmRouter = (
  business: Pick<Business, "id" | "llmProvider" | "llmApiKeySealed">,
) => LlmRoute;

export interface LlmRouterOptions {
  /** The server's own key (ANTHROPIC_API_KEY): used when a business has none. */
  defaultTransport: LlmTransport;
  claudeModel: string;
  geminiModel: string;
  secrets: SecretBox | null;
  makeClaude?: (apiKey: string) => LlmTransport;
  makeGemini?: (apiKey: string) => LlmTransport;
}

export function businessProvider(business: Pick<Business, "llmProvider">): LlmProvider {
  return LlmProviderSchema.catch("default").parse(business.llmProvider);
}

/**
 * Picks the engine of each business: its own key (sealed in the database) or the server's.
 * Transports are cached per sealed key, so a new key takes effect on the next message.
 */
export function createLlmRouter(options: LlmRouterOptions): LlmRouter {
  const makeClaude = options.makeClaude ?? anthropicTransport;
  const makeGemini = options.makeGemini ?? ((key: string) => geminiTransport(key));
  const cache = new Map<string, LlmTransport>();
  const fallback: LlmRoute = {
    transport: options.defaultTransport,
    model: options.claudeModel,
    provider: "default",
  };

  return (business) => {
    const provider = businessProvider(business);
    const sealed = business.llmApiKeySealed;
    if (provider === "default" || !sealed || !options.secrets) return fallback;

    const cacheKey = `${business.id}:${sealed}`;
    let transport = cache.get(cacheKey);
    if (!transport) {
      let apiKey: string;
      try {
        apiKey = options.secrets.open(sealed);
      } catch {
        return fallback; // SECRETS_KEY changed: the stored key can no longer be read
      }
      transport = provider === "gemini" ? makeGemini(apiKey) : makeClaude(apiKey);
      for (const key of cache.keys()) if (key.startsWith(`${business.id}:`)) cache.delete(key);
      cache.set(cacheKey, transport);
    }
    return {
      transport,
      model: provider === "gemini" ? options.geminiModel : options.claudeModel,
      provider,
    };
  };
}
