import { describe, expect, it } from "vitest";
import {
  fallbackWaMessage,
  newHandoffCode,
  sanitizeWaMessage,
  waText,
  waUrl,
} from "../src/engine/handoff";
import { parseLlmOutput, parseLlmOutputDetailed } from "../src/engine/llm-output";
import { findSensitiveTopic, preRules } from "../src/engine/pre-rules";
import { buildHistory, buildSystemPrompt } from "../src/engine/prompt";
import { allowedOriginHost } from "../src/engine/resolve-business";
import { IpRateLimiter } from "../src/engine/rate-limits";
import { hashToken, newSecretToken, tokenMatches } from "../src/lib/tokens";
import { isInHours, startOfLocalDay } from "../src/lib/time";

describe("preRules", () => {
  it.each([
    "Quiero hablar con una persona por WhatsApp",
    "necesito un HUMANO",
    "pásame con un asesor",
    "¿Puedo hablar con alguien?",
    "operadora por favor",
  ])("hands off explicit requests: %s", (message) => {
    expect(preRules(message, [])?.reason).toBe("EXPLICIT_REQUEST");
  });

  it("does not trigger on similar words", () => {
    expect(preRules("¿Hacen lentes personalizados?", [])).toBeNull();
  });

  it("matches sensitive topics without accents or case", () => {
    expect(preRules("Tengo un RECLAMO", ["reclamo"])?.reason).toBe("SENSITIVE_TOPIC");
    expect(findSensitiveTopic("es por mi receta medica", ["receta médica"])).toBe("receta médica");
    expect(findSensitiveTopic("tengo reclamos", ["reclamo"])).toBe("reclamo");
  });

  it("only matches topics at a word start", () => {
    expect(findSensitiveTopic("mira este modelo", ["ira"])).toBeNull();
  });
});

describe("parseLlmOutput", () => {
  const valid = {
    reply: "Abrimos a las 8.",
    handoff: false,
    reason: null,
    summary: "",
    quick_replies: ["¿Dónde están?"],
  };

  it("parses plain JSON", () => {
    expect(parseLlmOutput(JSON.stringify(valid))?.reply).toBe("Abrimos a las 8.");
  });

  it("extracts JSON from a code block or surrounding text", () => {
    expect(parseLlmOutput("```json\n" + JSON.stringify(valid) + "\n```")).not.toBeNull();
    expect(parseLlmOutput("Aquí va: " + JSON.stringify(valid) + " listo")).not.toBeNull();
  });

  it("defaults a missing reason to sin_informacion when handing off", () => {
    expect(parseLlmOutput(JSON.stringify({ ...valid, handoff: true }))?.reason).toBe(
      "sin_informacion",
    );
  });

  it("rejects invalid shapes and over-long fields", () => {
    expect(parseLlmOutput("no es json")).toBeNull();
    expect(parseLlmOutput(JSON.stringify({ ...valid, reply: "" }))).toBeNull();
    expect(parseLlmOutput(JSON.stringify({ ...valid, reply: "x".repeat(801) }))).toBeNull();
    expect(
      parseLlmOutput(JSON.stringify({ ...valid, reason: "limite", handoff: true })),
    ).toBeNull();
  });

  it("keeps a good answer when the quick replies are too many or too long", () => {
    const many = parseLlmOutput(
      JSON.stringify({
        ...valid,
        quick_replies: ["Cotizar", "Siniestros", "Pólizas", "Pagos", "Oficinas"],
      }),
    );
    expect(many?.reply).toBe("Abrimos a las 8.");
    expect(many?.quick_replies).toEqual(["Cotizar", "Siniestros", "Pólizas"]);

    const long = parseLlmOutput(
      JSON.stringify({ ...valid, quick_replies: ["x".repeat(81), " ", "y".repeat(80), "Pagos"] }),
    );
    expect(long?.quick_replies).toEqual(["y".repeat(80), "Pagos"]);
  });

  it("names the field that broke the schema, without content", () => {
    expect(parseLlmOutputDetailed("no es json")).toEqual({ ok: false, issue: "invalid json" });
    expect(parseLlmOutputDetailed(JSON.stringify({ ...valid, reply: "" }))).toEqual({
      ok: false,
      issue: "reply: too_small",
    });
    expect(
      parseLlmOutputDetailed(JSON.stringify({ ...valid, summary: "secreto ".repeat(100) })),
    ).toEqual({ ok: false, issue: "summary: too_big" });
  });

  it("treats an empty wa_message as missing", () => {
    expect(
      parseLlmOutput(JSON.stringify({ ...valid, wa_message: "  " }))?.wa_message,
    ).toBeUndefined();
  });
});

describe("handoff texts", () => {
  it("builds the fallback WhatsApp message without the requests for a person", () => {
    const text = fallbackWaMessage("Óptica Mirador", [
      "¿Cuánto cuestan los progresivos?",
      "Quiero hablar con una persona",
    ]);
    expect(text).toBe(
      "Hola Óptica Mirador, estuve consultando con su asistente virtual. Mi consulta es: ¿Cuánto cuestan los progresivos? ¿Me pueden ayudar?",
    );
  });

  it("closes messages without punctuation", () => {
    expect(fallbackWaMessage("Óptica", ["tienen lentes de sol", "y armazones?"])).toContain(
      "Mi consulta es: tienen lentes de sol. y armazones? ¿Me pueden ayudar?",
    );
  });

  it("encodes the wa.me link with the case code", () => {
    const url = waUrl("+595 981 000000", waText("Hola, ¿tienen stock?", "DER-1234"));
    expect(url.startsWith("https://wa.me/595981000000?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1] ?? "")).toBe(
      "Hola, ¿tienen stock?\n\n(Caso DER-1234)",
    );
  });

  it("removes links to our own apps", () => {
    expect(
      sanitizeWaMessage("Hola, vean https://panel.puente.test/derivaciones/DER-1 gracias", [
        "https://panel.puente.test",
      ]),
    ).toBe("Hola, vean gracias");
  });

  it("generates codes with 4 to 6 digits", () => {
    expect(newHandoffCode(0)).toMatch(/^DER-\d{4}$/);
    expect(newHandoffCode(3)).toMatch(/^DER-\d{5}$/);
    expect(newHandoffCode(7)).toMatch(/^DER-\d{6}$/);
  });
});

describe("prompt", () => {
  it("puts the business data and knowledge in the system prompt", () => {
    const prompt = buildSystemPrompt(
      {
        botName: "Luz",
        name: "Óptica Mirador",
        kind: "óptica",
        sensitiveTopics: ["reclamo"],
        voice: "tu",
      },
      [{ question: "¿Horario?", answer: "De 8 a 18." }],
    );
    expect(prompt).toContain('Eres Luz, asistente virtual de "Óptica Mirador" (óptica)');
    expect(prompt).toContain("TEMAS SENSIBLES: reclamo");
    expect(prompt).toContain("1. P: ¿Horario?\n   R: De 8 a 18.");
    expect(prompt).toContain("Tratas al cliente de tú.");
  });

  it("asks for voseo when the business uses vos", () => {
    const prompt = buildSystemPrompt(
      { botName: "Laura", name: "La Rural", kind: "seguros", sensitiveTopics: [], voice: "vos" },
      [],
    );
    expect(prompt).toContain("Tratás al cliente de vos");
  });

  it("keeps the last 20 turns and starts with the user", () => {
    const messages = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? ("USER" as const) : ("ASSISTANT" as const),
      content: `m${i}`,
    }));
    const history = buildHistory(messages);
    expect(history.length).toBeLessThanOrEqual(20);
    expect(history[0]?.role).toBe("user");
    expect(history.at(-1)?.content).toBe("m24");
  });
});

describe("origin check", () => {
  const domains = ["opticamirador.com"];
  it("accepts the exact host only", () => {
    expect(allowedOriginHost("https://opticamirador.com", domains, false)).toBe(
      "opticamirador.com",
    );
    expect(allowedOriginHost("https://www.opticamirador.com", domains, false)).toBeNull();
    expect(allowedOriginHost("https://opticamirador.com.evil.io", domains, false)).toBeNull();
    expect(allowedOriginHost(undefined, domains, false)).toBeNull();
    expect(allowedOriginHost("null", domains, false)).toBeNull();
  });

  it("allows localhost only when enabled (development)", () => {
    expect(allowedOriginHost("http://localhost:5173", domains, false)).toBeNull();
    expect(allowedOriginHost("http://localhost:5173", domains, true)).toBe("localhost");
  });
});

describe("time", () => {
  const hours = { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "18:00" };
  const tz = "America/Asuncion"; // UTC-3

  it("evaluates opening hours in the business time zone", () => {
    expect(isInHours(hours, tz, new Date("2026-09-30T12:00:00Z"))).toBe(true); // Wed 09:00
    expect(isInHours(hours, tz, new Date("2026-09-30T10:30:00Z"))).toBe(false); // Wed 07:30
    expect(isInHours(hours, tz, new Date("2026-09-30T21:00:00Z"))).toBe(false); // Wed 18:00
    expect(isInHours(hours, tz, new Date("2026-09-27T15:00:00Z"))).toBe(false); // Sunday
  });

  it("finds the local midnight", () => {
    expect(startOfLocalDay(new Date("2026-09-30T01:00:00Z"), tz).toISOString()).toBe(
      "2026-09-29T03:00:00.000Z",
    );
    expect(startOfLocalDay(new Date("2026-09-30T15:00:00Z"), "UTC").toISOString()).toBe(
      "2026-09-30T00:00:00.000Z",
    );
  });
});

describe("tokens and rate limiter", () => {
  it("matches only the right token", () => {
    const token = newSecretToken();
    expect(tokenMatches(token, hashToken(token))).toBe(true);
    expect(tokenMatches(newSecretToken(), hashToken(token))).toBe(false);
  });

  it("limits hits per window", () => {
    const limiter = new IpRateLimiter(2, 1000);
    expect(limiter.hit("1.1.1.1", 0)).toBe(true);
    expect(limiter.hit("1.1.1.1", 10)).toBe(true);
    expect(limiter.hit("1.1.1.1", 20)).toBe(false);
    expect(limiter.hit("2.2.2.2", 20)).toBe(true);
    expect(limiter.hit("1.1.1.1", 1000)).toBe(true);
  });
});
