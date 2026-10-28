import type { HandoffReason } from "@puente/shared";
import { normalizeText } from "../lib/text";
import type { CustomerLanguage } from "./language";

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

const RULE_REPLIES = {
  es: {
    explicit: () => "Claro, te conecto con una persona del equipo.",
    sensitive: (topic: string) =>
      `Para temas de ${topic} es mejor que te atienda una persona. Te conecto con el equipo.`,
  },
  // The topic list is written in Spanish, so it is not quoted in other languages.
  en: {
    explicit: () => "Of course, I'm connecting you with someone from our team.",
    sensitive: () =>
      "A person from our team is better placed to help with this. I'm connecting you.",
  },
  ja: {
    explicit: () => "かしこまりました。担当者におつなぎします。",
    sensitive: () => "この件は担当者が対応いたします。おつなぎします。",
  },
} as const;

/** Deterministic checks that hand off without calling the LLM (docs/SPEC.md §5 step 6). */
export function preRules(
  message: string,
  sensitiveTopics: string[],
  language: CustomerLanguage = "es",
): RuleDecision | null {
  const replies = RULE_REPLIES[language];
  if (isExplicitHumanRequest(message)) {
    return { reason: "EXPLICIT_REQUEST", reply: replies.explicit() };
  }
  const topic = findSensitiveTopic(message, sensitiveTopics);
  if (topic) return { reason: "SENSITIVE_TOPIC", reply: replies.sensitive(topic) };
  return null;
}
