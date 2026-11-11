import { describe, expect, it } from "vitest";
import {
  languageCounts,
  topQuestions,
  weeklySeries,
  weekStart,
  type ConversationFacts,
} from "../src/services/insights";

const fact = (day: string, handedOff: boolean, ...userTexts: string[]): ConversationFacts => ({
  day,
  handedOff,
  userTexts,
});

describe("weekStart", () => {
  it.each([
    ["2026-11-09", "2026-11-09"], // Monday
    ["2026-11-11", "2026-11-09"], // Wednesday
    ["2026-11-15", "2026-11-09"], // Sunday
    ["2026-11-01", "2026-10-26"], // across months
  ])("%s starts on %s", (day, monday) => {
    expect(weekStart(day)).toBe(monday);
  });
});

describe("weeklySeries", () => {
  it("covers every week of the period, empty ones included", () => {
    const series = weeklySeries(
      [
        fact("2026-10-27", false),
        fact("2026-10-28", true),
        fact("2026-11-11", false),
        fact("2026-09-01", false), // outside the period: ignored
      ],
      "2026-10-26",
      "2026-11-11",
    );
    expect(series).toEqual([
      { weekStart: "2026-10-26", conversations: 2, resolved: 1, handedOff: 1 },
      { weekStart: "2026-11-02", conversations: 0, resolved: 0, handedOff: 0 },
      { weekStart: "2026-11-09", conversations: 1, resolved: 1, handedOff: 0 },
    ]);
  });
});

describe("languageCounts", () => {
  it("counts each conversation once, by its customer's language", () => {
    expect(
      languageCounts([
        fact("2026-11-11", false, "¿Cuál es el horario?"),
        fact("2026-11-11", false, "What are your hours?", "ok"),
        fact("2026-11-11", false, "営業時間を教えてください"),
        fact("2026-11-11", false, "ok"),
      ]),
    ).toEqual({ es: 1, en: 1, ja: 1, unknown: 1 });
  });
});

describe("topQuestions", () => {
  it("groups repeats once per conversation, drops small talk and one-offs", () => {
    const top = topQuestions([
      fact("2026-11-11", false, "Hola", "¿Cubren granizo?", "¿cubren granizo?"),
      fact("2026-11-11", false, "hola!", "Cubren granizo"),
      fact("2026-11-11", false, "Gracias", "¿Dónde están?", "¿Dónde están?"),
      fact("2026-11-11", false, "¿Dónde están?"),
      fact("2026-11-11", false, "¿Hacen envíos?"),
      fact("2026-11-11", false, "ありがとう"),
      fact("2026-11-11", false, "ありがとう"),
    ]);
    expect(top).toEqual([
      { question: "¿Cubren granizo?", conversations: 2 },
      { question: "¿Dónde están?", conversations: 2 },
    ]);
  });
});
