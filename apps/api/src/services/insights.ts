import type { CustomerLanguage, MetricsResponse } from "@puente/shared";
import { conversationLanguage } from "../engine/language";
import { questionKey } from "./unanswered";

/** One conversation of the period, as the summary needs it. */
export interface ConversationFacts {
  /** Local day (YYYY-MM-DD) the conversation started, in the business timezone. */
  day: string;
  handedOff: boolean;
  /** The customer's messages, oldest first. */
  userTexts: string[];
}

export const TOP_QUESTIONS = 10;

// Greetings and one-word acknowledgements say nothing about what customers need.
const SMALL_TALK = new Set(
  [
    "hola",
    "buenas",
    "buen dia",
    "buenos dias",
    "buenas tardes",
    "buenas noches",
    "hola buenas",
    "hola buen dia",
    "hola buenos dias",
    "hola buenas tardes",
    "gracias",
    "muchas gracias",
    "ok",
    "okay",
    "si",
    "sí",
    "no",
    "dale",
    "listo",
    "hi",
    "hello",
    "thanks",
    "thank you",
    "yes",
    "こんにちは",
    "ありがとう",
    "ありがとうございます",
    "はい",
  ].map(questionKey),
);

const DAY_MS = 86_400_000;

function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T12:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Monday of the week that contains `day` (both YYYY-MM-DD). */
export function weekStart(day: string): string {
  return addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
}

/** Every week touching [fromDay, toDay], empty ones included, so the trend has no holes. */
export function weeklySeries(
  facts: ConversationFacts[],
  fromDay: string,
  toDay: string,
): MetricsResponse["weekly"] {
  const weeks = new Map<string, MetricsResponse["weekly"][number]>();
  const last = weekStart(toDay);
  for (let week = weekStart(fromDay); week <= last; week = addDays(week, 7)) {
    weeks.set(week, { weekStart: week, conversations: 0, resolved: 0, handedOff: 0 });
  }
  for (const f of facts) {
    const row = weeks.get(weekStart(f.day));
    if (!row) continue;
    row.conversations++;
    if (f.handedOff) row.handedOff++;
    else row.resolved++;
  }
  return [...weeks.values()];
}

export function languageCounts(facts: ConversationFacts[]): MetricsResponse["languages"] {
  const counts: Record<CustomerLanguage | "unknown", number> = { es: 0, en: 0, ja: 0, unknown: 0 };
  for (const f of facts) counts[conversationLanguage(f.userTexts) ?? "unknown"]++;
  return counts;
}

/**
 * What customers ask most: messages that repeat across conversations (same words, any case or
 * punctuation), counted once per conversation. Greetings and one-word answers are left out.
 */
export function topQuestions(facts: ConversationFacts[]): MetricsResponse["topQuestions"] {
  const groups = new Map<string, { question: string; conversations: number }>();
  for (const f of facts) {
    const seen = new Set<string>();
    for (const text of f.userTexts) {
      const key = questionKey(text);
      if (!key || SMALL_TALK.has(key) || seen.has(key)) continue;
      seen.add(key);
      const group = groups.get(key);
      if (group) group.conversations++;
      else groups.set(key, { question: text.trim(), conversations: 1 });
    }
  }
  return [...groups.values()]
    .filter((g) => g.conversations > 1)
    .sort((a, b) => b.conversations - a.conversations || a.question.localeCompare(b.question))
    .slice(0, TOP_QUESTIONS);
}
