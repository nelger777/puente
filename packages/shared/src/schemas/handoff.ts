import { z } from "zod";

export const HandoffReasonSchema = z.enum([
  "EXPLICIT_REQUEST",
  "NO_INFORMATION",
  "SENSITIVE_TOPIC",
  "FRUSTRATION",
  "REPETITION",
  "LIMIT",
  "TECHNICAL_FAILURE",
]);
export type HandoffReason = z.infer<typeof HandoffReasonSchema>;

/** Reasons the LLM may return. LIMIT and TECHNICAL_FAILURE are server-only. */
export const LlmHandoffReasonSchema = z.enum([
  "pedido_explicito",
  "sin_informacion",
  "tema_sensible",
  "frustracion",
  "repeticion",
]);
export type LlmHandoffReason = z.infer<typeof LlmHandoffReasonSchema>;

export const LLM_REASON_TO_HANDOFF_REASON = {
  pedido_explicito: "EXPLICIT_REQUEST",
  sin_informacion: "NO_INFORMATION",
  tema_sensible: "SENSITIVE_TOPIC",
  frustracion: "FRUSTRATION",
  repeticion: "REPETITION",
} as const satisfies Record<LlmHandoffReason, HandoffReason>;

export const HANDOFF_REASON_LABELS = {
  EXPLICIT_REQUEST: "Pidió una persona",
  NO_INFORMATION: "Sin información",
  SENSITIVE_TOPIC: "Tema sensible",
  FRUSTRATION: "Cliente molesto",
  REPETITION: "No se resolvió",
  LIMIT: "Límite de mensajes",
  TECHNICAL_FAILURE: "IA no disponible",
} as const satisfies Record<HandoffReason, string>;

export const HandoffStatusSchema = z.enum(["PENDING", "RESOLVED"]);
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

/** "DER-" followed by 4 to 6 digits. */
export const HandoffCodeSchema = z.string().regex(/^DER-\d{4,6}$/);
