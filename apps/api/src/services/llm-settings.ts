import type { LlmSettings, LlmTestResponse } from "@puente/shared";
import type { Db } from "../db/client";
import { callLlm } from "../engine/llm";
import type { Business } from "../generated/prisma/client";
import { ApiError } from "../lib/errors";
import type { SecretBox } from "../lib/secrets";
import type { LlmRouter } from "./llm-router";

/**
 * Saves the AI engine of a business. The key is write-only: sealed with SECRETS_KEY and only
 * its last 4 characters are kept in clear, to recognize it in the panel.
 */
export async function updateLlmSettings(
  db: Db,
  business: Business,
  settings: LlmSettings,
  secrets: SecretBox | null,
): Promise<Business> {
  if (settings.provider === "default") {
    return db.business.update({
      where: { id: business.id },
      data: { llmProvider: "default", llmApiKeySealed: null, llmApiKeyLast4: null },
    });
  }
  if (!secrets) {
    throw new ApiError(409, "conflict", "El servidor no tiene SECRETS_KEY configurada");
  }
  if (settings.apiKey) {
    return db.business.update({
      where: { id: business.id },
      data: {
        llmProvider: settings.provider,
        llmApiKeySealed: secrets.seal(settings.apiKey),
        llmApiKeyLast4: settings.apiKey.slice(-4),
      },
    });
  }
  // Without a new key, only the same provider with a key already saved is valid.
  if (business.llmProvider !== settings.provider || !business.llmApiKeySealed) {
    throw new ApiError(400, "invalid_request", "Pega la clave del motor elegido");
  }
  return business;
}

const TEST_SYSTEM =
  'Es una prueba de conexión. Responde solo el JSON pedido, con reply "ok", handoff false, ' +
  'reason null, summary "", wa_message "" y quick_replies [].';

/** One minimal call with the saved configuration, to check the key before real customers. */
export async function testLlm(
  business: Business,
  llmFor: LlmRouter,
  timeoutMs: number,
): Promise<LlmTestResponse> {
  const route = llmFor(business);
  const result = await callLlm(route.transport, { model: route.model, timeoutMs }, TEST_SYSTEM, [
    { role: "user", content: "Hola" },
  ]);
  if (result.ok) {
    return { ok: true, message: "Conexión correcta", latencyMs: result.latencyMs };
  }
  const message =
    result.failure === "timeout"
      ? "El motor no respondió a tiempo"
      : result.failure === "invalid_output"
        ? "El motor respondió, pero no en el formato esperado"
        : "El motor rechazó la llamada: revisa la clave, su cuota o que esté activa";
  return { ok: false, message, latencyMs: result.latencyMs };
}
