import type { HandoffReason } from "@puente/shared";
import { normalizeText } from "../lib/text";

const EXPLICIT_REQUEST =
  /\b(personas?|humanos?|asesor(es|as?)?|agentes?|operador(es|as?)?|hablar con alguien)\b/;

export function isExplicitHumanRequest(message: string): boolean {
  return EXPLICIT_REQUEST.test(normalizeText(message));
}

export function findSensitiveTopic(message: string, topics: string[]): string | null {
  const text = ` ${normalizeText(message)} `;
  for (const topic of topics) {
    const needle = normalizeText(topic);
    // Match at a word start so "ira" does not hit "mira", but "reclamo" hits "reclamos".
    if (needle && text.includes(` ${needle}`)) return topic.trim();
  }
  return null;
}

export interface RuleDecision {
  reason: Extract<HandoffReason, "EXPLICIT_REQUEST" | "SENSITIVE_TOPIC">;
  reply: string;
}

/** Deterministic checks that hand off without calling the LLM (docs/SPEC.md §5 step 6). */
export function preRules(message: string, sensitiveTopics: string[]): RuleDecision | null {
  if (isExplicitHumanRequest(message)) {
    return { reason: "EXPLICIT_REQUEST", reply: "Claro, te conecto con una persona del equipo." };
  }
  const topic = findSensitiveTopic(message, sensitiveTopics);
  if (topic) {
    return {
      reason: "SENSITIVE_TOPIC",
      reply: `Para temas de ${topic} es mejor que te atienda una persona. Te conecto con el equipo.`,
    };
  }
  return null;
}
