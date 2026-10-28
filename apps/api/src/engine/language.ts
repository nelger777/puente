import { normalizeText } from "../lib/text";

/** Languages with fixed replies and an explicit hint to the model; others are left to it. */
export type CustomerLanguage = "es" | "en" | "ja";

export const LANGUAGE_NAMES: Record<CustomerLanguage, string> = {
  es: "español",
  en: "inglés",
  ja: "japonés",
};

// Kana only: Han alone may be Chinese.
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const SPANISH_MARKS = /[ñ¿¡áéíóú]/i;
// Common words that exist in only one of the two languages ("no", "me", "a" are left out).
const EN_WORDS = new Set(
  "the is are am i you my your what how do does can could would to for of and with about it this that where when hello hi please thanks thank want need have has insurance car policy quote".split(
    " ",
  ),
);
const ES_WORDS = new Set(
  "el la los las de que y en es un una por para con mi tu como quiero hola gracias cuanto donde necesito tengo seguro puedo quisiera auto poliza cotizar esta estoy".split(
    " ",
  ),
);

/** Best guess for one message, or null when it is too short or mixed to tell ("ok", "123"). */
export function detectLanguage(text: string): CustomerLanguage | null {
  if (KANA.test(text)) return "ja";
  if (SPANISH_MARKS.test(text)) return "es";
  let en = 0;
  let es = 0;
  for (const word of normalizeText(text).split(" ")) {
    if (EN_WORDS.has(word)) en++;
    if (ES_WORDS.has(word)) es++;
  }
  if (en > es) return "en";
  if (es > en) return "es";
  return null;
}

/** The language of the latest message that tells one; earlier ones carry over short replies. */
export function conversationLanguage(userMessages: string[]): CustomerLanguage | null {
  for (let i = userMessages.length - 1; i >= 0; i--) {
    const language = detectLanguage(userMessages[i] ?? "");
    if (language) return language;
  }
  return null;
}
