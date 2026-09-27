import Anthropic from "@anthropic-ai/sdk";
import { ChatResponseSchema, type ChatResponse } from "@puente/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { IpRateLimiter } from "../src/engine/rate-limits";
import { REPLIES } from "../src/engine/pipeline";
import {
  answer,
  createBusiness,
  FakeLlm,
  handoffAnswer,
  makeApp,
  ORIGIN,
  postChat,
  resetDb,
  testDb,
} from "./helpers";

const db = testDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$disconnect();
});

function body(res: { json: () => unknown }): ChatResponse {
  return ChatResponseSchema.parse(res.json());
}

describe("GET /v1/widget/config", () => {
  it("returns the public config to an authorized origin", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db);
    const res = await app.inject({
      method: "GET",
      url: `/v1/widget/config?key=${business.publicKey}`,
      headers: { origin: ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.json()).toMatchObject({
      businessName: "Óptica Mirador",
      botName: "Luz",
      greeting: "¡Hola! Soy Luz.",
      suggestions: ["¿Cuál es el horario?"],
    });
  });

  it("rejects unknown keys, inactive businesses and foreign origins", async () => {
    const business = await createBusiness(db);
    const inactive = await createBusiness(db, { active: false });
    const { app } = makeApp(db);
    const get = (key: string, origin = ORIGIN) =>
      app.inject({ method: "GET", url: `/v1/widget/config?key=${key}`, headers: { origin } });

    const unknown = await get("pk_doesnotexist123");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({
      error: { code: "business_not_found", message: "Business not found" },
    });
    expect((await get(inactive.publicKey)).statusCode).toBe(404);

    const foreign = await get(business.publicKey, "https://otro-sitio.com");
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toMatchObject({ error: { code: "origin_not_allowed" } });
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();

    expect((await get("not-a-key")).json()).toMatchObject({ error: { code: "invalid_request" } });
  });
});

describe("POST /v1/chat — resolved by the assistant", () => {
  it("answers, stores the turn with tokens and continues the same conversation", async () => {
    const business = await createBusiness(db);
    const llm = new FakeLlm([
      answer("Atendemos de lunes a sábado de 08:00 a 18:00.", ["¿Dónde están?"]),
      answer("Estamos frente a la plaza."),
    ]);
    const { app } = makeApp(db, { llm });

    const first = body(await postChat(app, { key: business.publicKey, message: "¿Horario?" }));
    expect(first).toMatchObject({
      reply: "Atendemos de lunes a sábado de 08:00 a 18:00.",
      quickReplies: ["¿Dónde están?"],
      remainingMessages: 19,
      handoff: null,
    });
    expect(first.conversationId).toMatch(/^conv_/);

    const second = body(
      await postChat(app, {
        key: business.publicKey,
        message: "¿Dónde quedan?",
        conversationId: first.conversationId,
        conversationToken: first.conversationToken,
      }),
    );
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.remainingMessages).toBe(18);

    // The model sees the previous turn and the knowledge base.
    const lastCall = llm.calls[1];
    expect(lastCall?.model).toBe("claude-haiku-4-5-20251001");
    expect(lastCall?.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(lastCall?.system)).toContain("¿Cuál es el horario?");

    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: first.conversationId },
      include: { messages: true },
    });
    expect(conversation.userMessageCount).toBe(2);
    expect(conversation.tokenHash).not.toBe(first.conversationToken);
    const reply = conversation.messages.find((m) => m.role === "ASSISTANT");
    expect(reply).toMatchObject({ engine: "llm", inputTokens: 120, outputTokens: 30 });
  });

  it("starts a new conversation when the token does not match", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db, { llm: new FakeLlm([answer("Hola."), answer("Hola.")]) });
    const first = body(await postChat(app, { key: business.publicKey, message: "Hola" }));
    const second = body(
      await postChat(app, {
        key: business.publicKey,
        message: "Hola",
        conversationId: first.conversationId,
        conversationToken: "x".repeat(43),
      }),
    );
    expect(second.conversationId).not.toBe(first.conversationId);
  });
});

describe("POST /v1/chat — handoff reasons", () => {
  it("EXPLICIT_REQUEST: hands off without calling the model and e-mails the team", async () => {
    const business = await createBusiness(db);
    const { app, llm, mailer } = makeApp(db);

    const res = body(
      await postChat(app, {
        key: business.publicKey,
        message: "Quiero hablar con una persona por WhatsApp",
      }),
    );
    expect(llm.calls).toHaveLength(0);
    expect(res.reply).toBe("Claro, te conecto con una persona del equipo.");
    expect(res.handoff?.reason).toBe("EXPLICIT_REQUEST");
    expect(res.handoff?.code).toMatch(/^DER-\d{4,6}$/);

    const waUrl = new URL(res.handoff?.waUrl ?? "");
    expect(waUrl.origin + waUrl.pathname).toBe("https://wa.me/595981000000");
    expect(waUrl.searchParams.get("text")).toBe(
      `Hola Óptica Mirador, vengo de su asistente virtual y quisiera hablar con una persona del equipo.\n\n(Caso ${res.handoff?.code})`,
    );

    await app.background.drain();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("equipo@opticamirador.com");
    expect(mailer.sent[0]?.subject).toContain(res.handoff?.code);
    expect(mailer.sent[0]?.text).toContain(
      `https://panel.puente.test/derivaciones/${res.handoff?.code}`,
    );

    const events = await db.handoffEvent.findMany({ orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["created", "email_sent"]);
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: res.conversationId },
    });
    expect(conversation.status).toBe("HANDED_OFF");
  });

  it("SENSITIVE_TOPIC: hands off by rule", async () => {
    const business = await createBusiness(db);
    const { app, llm } = makeApp(db);
    const res = body(
      await postChat(app, { key: business.publicKey, message: "Tengo un reclamo por mis lentes" }),
    );
    expect(llm.calls).toHaveLength(0);
    expect(res.handoff?.reason).toBe("SENSITIVE_TOPIC");
    expect(res.reply).toContain("reclamo");
  });

  it.each([
    ["sin_informacion", "NO_INFORMATION"],
    ["frustracion", "FRUSTRATION"],
    ["repeticion", "REPETITION"],
  ])("%s from the model maps to %s", async (llmReason, reason) => {
    const business = await createBusiness(db);
    const { app } = makeApp(db, { llm: new FakeLlm([handoffAnswer(llmReason)]) });
    const res = body(
      await postChat(app, { key: business.publicKey, message: "¿Precio progresivos?" }),
    );
    expect(res.handoff?.reason).toBe(reason);
    expect(res.handoff?.waMessage).toBe("Hola, quiero saber el precio de unos lentes progresivos.");
    expect(res.reply).toBe("Te conecto con una persona del equipo.");
    const handoff = await db.handoff.findFirstOrThrow();
    expect(handoff.summary).toBe("El cliente necesita ayuda.");
  });

  it("LIMIT: hands off without the model once the conversation limit is reached", async () => {
    const business = await createBusiness(db, { maxMessagesPerConv: 2 });
    const llm = new FakeLlm([answer("Uno."), answer("Dos.")]);
    const { app } = makeApp(db, { llm });

    let res = body(await postChat(app, { key: business.publicKey, message: "uno" }));
    const ids = { conversationId: res.conversationId, conversationToken: res.conversationToken };
    res = body(await postChat(app, { key: business.publicKey, message: "dos", ...ids }));
    expect(res.remainingMessages).toBe(0);

    const limited = await postChat(app, { key: business.publicKey, message: "tres", ...ids });
    expect(limited.statusCode).toBe(200);
    const third = body(limited);
    expect(third.handoff?.reason).toBe("LIMIT");
    expect(third.reply).toBe(REPLIES.limit);
    expect(llm.calls).toHaveLength(2);

    const fourth = body(
      await postChat(app, { key: business.publicKey, message: "cuatro", ...ids }),
    );
    expect(fourth.reply).toBe(REPLIES.limitAlreadyHandedOff);
    expect(fourth.handoff?.code).toBe(third.handoff?.code);
  });

  it("TECHNICAL_FAILURE: invalid model output still answers 200 with a handoff", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db, { llm: new FakeLlm([{ text: "no es JSON" }]) });
    const res = await postChat(app, { key: business.publicKey, message: "¿Horario?" });
    expect(res.statusCode).toBe(200);
    expect(body(res).handoff?.reason).toBe("TECHNICAL_FAILURE");
    expect(body(res).reply).toBe(REPLIES.technicalFailure);
    const reply = await db.message.findFirstOrThrow({ where: { role: "ASSISTANT" } });
    expect(reply).toMatchObject({ engine: "rules", inputTokens: 120 });
  });

  it("TECHNICAL_FAILURE: a model timeout answers 200 with a handoff", async () => {
    const business = await createBusiness(db);
    const { app, llm } = makeApp(db, { llm: new FakeLlm(["hang"]) });
    const started = Date.now();
    const res = await postChat(app, { key: business.publicKey, message: "¿Horario?" });
    expect(res.statusCode).toBe(200);
    expect(body(res).handoff?.reason).toBe("TECHNICAL_FAILURE");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(llm.calls).toHaveLength(1); // timeouts are not retried
  });

  it("TECHNICAL_FAILURE: truncated or refused output is not trusted", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db, {
      llm: new FakeLlm([{ text: JSON.stringify(answer("Hola").json), stopReason: "max_tokens" }]),
    });
    const res = body(await postChat(app, { key: business.publicKey, message: "¿Horario?" }));
    expect(res.handoff?.reason).toBe("TECHNICAL_FAILURE");
  });

  it("retries once on network errors and 5xx, never more", async () => {
    const business = await createBusiness(db);
    const serverError = new Anthropic.InternalServerError(500, undefined, "boom", new Headers());
    const llm = new FakeLlm([
      { error: new Anthropic.APIConnectionError({ message: "socket hang up" }) },
      answer("Recuperado."),
      { error: serverError },
      { error: serverError },
    ]);
    const { app } = makeApp(db, { llm });

    const ok = body(await postChat(app, { key: business.publicKey, message: "¿Horario?" }));
    expect(ok.reply).toBe("Recuperado.");
    const failed = body(await postChat(app, { key: business.publicKey, message: "¿Horario?" }));
    expect(failed.handoff?.reason).toBe("TECHNICAL_FAILURE");
    expect(llm.calls).toHaveLength(4);
  });

  it("does not retry client errors", async () => {
    const business = await createBusiness(db);
    const llm = new FakeLlm([
      { error: new Anthropic.BadRequestError(400, undefined, "bad", new Headers()) },
    ]);
    const { app } = makeApp(db, { llm });
    const res = body(await postChat(app, { key: business.publicKey, message: "¿Horario?" }));
    expect(res.handoff?.reason).toBe("TECHNICAL_FAILURE");
    expect(llm.calls).toHaveLength(1);
  });
});

describe("POST /v1/chat — one pending handoff per conversation", () => {
  it("updates the pending case, keeps its first reason and e-mails only once", async () => {
    const business = await createBusiness(db);
    const llm = new FakeLlm([
      handoffAnswer("frustracion", {
        summary: "Resumen nuevo.",
        wa_message: "Hola, sigo esperando.",
      }),
    ]);
    const { app, mailer } = makeApp(db, { llm });

    const first = body(
      await postChat(app, { key: business.publicKey, message: "Quiero hablar con un asesor" }),
    );
    const ids = {
      conversationId: first.conversationId,
      conversationToken: first.conversationToken,
    };
    const second = body(await postChat(app, { key: business.publicKey, message: "¿y?", ...ids }));
    const third = body(
      await postChat(app, { key: business.publicKey, message: "persona!", ...ids }),
    );

    expect(second.handoff?.code).toBe(first.handoff?.code);
    expect(third.handoff?.code).toBe(first.handoff?.code);
    const handoffs = await db.handoff.findMany();
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]).toMatchObject({
      reason: "EXPLICIT_REQUEST",
      summary: "Resumen nuevo.",
      waMessage: "Hola, sigo esperando.",
    });

    await app.background.drain();
    expect(mailer.sent).toHaveLength(1);
    const types = (await db.handoffEvent.findMany()).map((e) => e.type).sort();
    expect(types).toEqual(["created", "email_sent", "updated", "updated"]);
  });

  it("never creates two cases under concurrent messages", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db);
    const first = body(await postChat(app, { key: business.publicKey, message: "reclamo" }));
    const ids = {
      conversationId: first.conversationId,
      conversationToken: first.conversationToken,
    };
    await db.handoff.deleteMany();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        postChat(app, { key: business.publicKey, message: "quiero un humano", ...ids }),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(await db.handoff.count()).toBe(1);
  });
});

describe("POST /v1/chat — WhatsApp text and hours", () => {
  it("strips links to our own apps from the model's WhatsApp text", async () => {
    const business = await createBusiness(db);
    const llm = new FakeLlm([
      handoffAnswer("sin_informacion", {
        wa_message: "Hola, mi caso está en https://panel.puente.test/derivaciones/DER-1 gracias.",
      }),
    ]);
    const { app } = makeApp(db, { llm });
    const res = body(await postChat(app, { key: business.publicKey, message: "¿Precio?" }));
    expect(res.handoff?.waMessage).toBe("Hola, mi caso está en gracias.");
    expect(res.handoff?.waUrl).not.toContain("panel.puente.test");
  });

  it("reports off-hours handoffs with the business message", async () => {
    const business = await createBusiness(db, {
      hours: { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" },
    });
    const sunday = new Date("2026-09-27T15:00:00Z");
    const { app } = makeApp(db, { now: () => sunday });
    const res = body(await postChat(app, { key: business.publicKey, message: "un asesor" }));
    expect(res.handoff).toMatchObject({
      inHours: false,
      offHoursMessage: "Te responderán apenas abran.",
    });
    expect((await db.handoff.findFirstOrThrow()).openedInHours).toBe(false);
  });
});

describe("POST /v1/chat — access and limits", () => {
  it("rejects foreign origins with 403 and never calls the model", async () => {
    const business = await createBusiness(db);
    const { app, llm } = makeApp(db);
    const res = await postChat(
      app,
      { key: business.publicKey, message: "hola" },
      "https://evil.io",
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "origin_not_allowed" } });
    expect(llm.calls).toHaveLength(0);
    expect(await db.conversation.count()).toBe(0);
  });

  it("validates the request body", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db);
    const tooLong = await postChat(app, { key: business.publicKey, message: "a".repeat(1001) });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toMatchObject({ error: { code: "invalid_request" } });
    const blank = await postChat(app, { key: business.publicKey, message: "   " });
    expect(blank.statusCode).toBe(400);
  });

  it("limits requests per IP", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db, {
      limiter: new IpRateLimiter(2, 60_000),
      llm: new FakeLlm([answer("a"), answer("b")]),
    });
    await postChat(app, { key: business.publicKey, message: "1" });
    await postChat(app, { key: business.publicKey, message: "2" });
    const res = await postChat(app, { key: business.publicKey, message: "3" });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: { code: "rate_limited" } });
  });

  it("enforces the business daily cap", async () => {
    const business = await createBusiness(db, { dailyMessageCap: 1 });
    const { app } = makeApp(db, { llm: new FakeLlm([answer("a")]) });
    expect((await postChat(app, { key: business.publicKey, message: "1" })).statusCode).toBe(200);
    const res = await postChat(app, { key: business.publicKey, message: "2" });
    expect(res.statusCode).toBe(429);
  });

  it("answers CORS preflight", async () => {
    const { app } = makeApp(db);
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/chat",
      headers: { origin: ORIGIN, "access-control-request-method": "POST" },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });
});

describe("business isolation", () => {
  it("never reuses another business's conversation", async () => {
    const a = await createBusiness(db);
    const b = await createBusiness(db);
    const { app } = makeApp(db, { llm: new FakeLlm([answer("A"), answer("B")]) });
    const fromA = body(await postChat(app, { key: a.publicKey, message: "hola" }));
    const fromB = body(
      await postChat(app, {
        key: b.publicKey,
        message: "hola",
        conversationId: fromA.conversationId,
        conversationToken: fromA.conversationToken,
      }),
    );
    expect(fromB.conversationId).not.toBe(fromA.conversationId);
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: fromB.conversationId },
    });
    expect(conversation.businessId).toBe(b.id);
  });
});
