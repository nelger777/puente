import {
  BusinessResponseSchema,
  ChatResponseSchema,
  HandoffDetailSchema,
  HandoffListResponseSchema,
  MetricsResponseSchema,
  type BusinessSettings,
} from "@puente/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  answer,
  createBusiness,
  createUser,
  FakeLlm,
  loginAs,
  makeApp,
  PANEL_ORIGIN,
  PASSWORD,
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

type App = ReturnType<typeof makeApp>["app"];

function call(
  app: App,
  cookie: string,
  method: "GET" | "PUT" | "PATCH" | "POST",
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { cookie, origin: PANEL_ORIGIN },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function setup() {
  const business = await createBusiness(db);
  const admin = await createUser(db, business.id, "ADMIN");
  const agent = await createUser(db, business.id, "AGENT");
  const { app, llm } = makeApp(db);
  return { business, admin, agent, app, llm };
}

describe("auth", () => {
  it("logs in with a secure httpOnly cookie, reports the session and logs out", async () => {
    const { app, admin } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { origin: PANEL_ORIGIN },
      payload: { email: admin.email.toUpperCase(), password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "puente_session");
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(res.json()).toMatchObject({ user: { email: admin.email, role: "ADMIN" } });

    const header = `puente_session=${cookie?.value}`;
    const session = await db.session.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(cookie?.value);

    expect((await call(app, header, "GET", "/v1/auth/me")).statusCode).toBe(200);
    expect((await call(app, header, "POST", "/v1/auth/logout")).statusCode).toBe(204);
    const after = await call(app, header, "GET", "/v1/auth/me");
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("rejects wrong passwords and unknown users alike", async () => {
    const { app, admin } = await setup();
    const login = (email: string, password: string) =>
      app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { origin: PANEL_ORIGIN },
        payload: { email, password },
      });
    const wrong = await login(admin.email, "incorrecta");
    const unknown = await login("nadie@test.com", "incorrecta");
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("locks the account for 15 minutes after 5 failed attempts", async () => {
    const business = await createBusiness(db);
    const admin = await createUser(db, business.id);
    let now = new Date("2026-09-30T12:00:00Z");
    const { app } = makeApp(db, { now: () => now });
    const login = (password: string) =>
      app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { origin: PANEL_ORIGIN },
        payload: { email: admin.email, password },
      });

    for (let i = 0; i < 4; i++) expect((await login("mala")).statusCode).toBe(401);
    const fifth = await login("mala");
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json()).toMatchObject({ error: { code: "too_many_attempts" } });
    // Even the right password is refused while locked.
    expect((await login(PASSWORD)).statusCode).toBe(429);

    now = new Date(now.getTime() + 15 * 60 * 1000 + 1000);
    expect((await login(PASSWORD)).statusCode).toBe(200);
  });

  it("refuses state-changing requests from another origin", async () => {
    const { app, admin } = await setup();
    const cookie = await loginAs(app, admin.email);
    const res = await app.inject({
      method: "PUT",
      url: "/v1/admin/knowledge",
      headers: { cookie, origin: "https://evil.io" },
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(403);
    expect(await db.knowledgeItem.count()).toBe(1);
  });

  it("requires a session on every admin route", async () => {
    const { app } = await setup();
    for (const url of [
      "/v1/admin/business",
      "/v1/admin/knowledge",
      "/v1/admin/handoffs",
      "/v1/admin/metrics",
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
  });
});

describe("business settings", () => {
  const settings = (overrides: Partial<BusinessSettings> = {}): BusinessSettings => ({
    name: "Óptica Mirador Centro",
    kind: "óptica",
    botName: "Sol",
    brandColor: "#0F7A6B",
    whatsappNumber: "595981222333",
    notifyEmail: "nuevo@opticamirador.com",
    timezone: "America/Asuncion",
    hours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" },
    offHoursMessage: "Volvemos mañana.",
    greeting: "¡Hola! Soy Sol.",
    suggestions: ["¿Horario?"],
    sensitiveTopics: ["garantía"],
    allowedDomains: ["opticamirador.com", "www.opticamirador.com"],
    maxMessagesPerConv: 15,
    dailyMessageCap: 500,
    active: true,
    ...overrides,
  });

  it("lets an admin read and update the configuration", async () => {
    const { app, admin } = await setup();
    const cookie = await loginAs(app, admin.email);
    const res = await call(app, cookie, "PUT", "/v1/admin/business", settings());
    expect(res.statusCode).toBe(200);
    const body = BusinessResponseSchema.parse(res.json());
    expect(body).toMatchObject({
      botName: "Sol",
      widgetScriptUrl: "https://cdn.puente.test/v1.js",
    });
    const got = BusinessResponseSchema.parse(
      (await call(app, cookie, "GET", "/v1/admin/business")).json(),
    );
    expect(got.allowedDomains).toEqual(["opticamirador.com", "www.opticamirador.com"]);
  });

  it("validates every field", async () => {
    const { app, admin } = await setup();
    const cookie = await loginAs(app, admin.email);
    for (const bad of [
      settings({ timezone: "Mars/Olympus" }),
      settings({ brandColor: "blue" }),
      settings({ whatsappNumber: "+595 981" }),
      settings({ allowedDomains: ["https://tienda.com/"] }),
      settings({ hours: { days: [1], from: "18:00", to: "08:00" } }),
      settings({ name: " " }),
    ]) {
      const res = await call(app, cookie, "PUT", "/v1/admin/business", bad);
      expect(res.statusCode).toBe(400);
    }
  });

  it("lets agents read but not change it", async () => {
    const { app, agent } = await setup();
    const cookie = await loginAs(app, agent.email);
    expect((await call(app, cookie, "GET", "/v1/admin/business")).statusCode).toBe(200);
    const res = await call(app, cookie, "PUT", "/v1/admin/business", settings());
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "forbidden" } });
    expect((await call(app, cookie, "GET", "/v1/admin/knowledge")).statusCode).toBe(403);
  });
});

describe("knowledge base", () => {
  it("replaces the whole list in order", async () => {
    const { app, admin } = await setup();
    const cookie = await loginAs(app, admin.email);
    const items = [
      { question: "¿Hacen envíos?", answer: "Sí." },
      { question: "¿Aceptan tarjeta?", answer: "Sí, todas." },
    ];
    const res = await call(app, cookie, "PUT", "/v1/admin/knowledge", { items });
    expect(res.statusCode).toBe(200);
    const stored = await db.knowledgeItem.findMany({ orderBy: { position: "asc" } });
    expect(stored.map((k) => [k.question, k.position])).toEqual([
      ["¿Hacen envíos?", 0],
      ["¿Aceptan tarjeta?", 1],
    ]);
  });

  it("keeps the previous list when the new one is invalid", async () => {
    const { app, admin } = await setup();
    const cookie = await loginAs(app, admin.email);
    const res = await call(app, cookie, "PUT", "/v1/admin/knowledge", {
      items: [
        { question: "Válida", answer: "Sí" },
        { question: "", answer: "sin pregunta" },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(await db.knowledgeItem.count()).toBe(1);
  });
});

describe("handoffs and metrics", () => {
  async function openCase(app: App, key: string, message = "Quiero hablar con una persona") {
    const chat = ChatResponseSchema.parse((await postChat(app, { key, message })).json());
    if (!chat.handoff) throw new Error("expected a handoff");
    return chat.handoff.code;
  }

  it("lists, shows and resolves a case, then reopens it", async () => {
    const { app, business, agent } = await setup();
    const code = await openCase(app, business.publicKey);
    const cookie = await loginAs(app, agent.email);

    const list = HandoffListResponseSchema.parse(
      (await call(app, cookie, "GET", "/v1/admin/handoffs?status=PENDING")).json(),
    );
    expect(list.pendingCount).toBe(1);
    expect(list.items.map((h) => h.code)).toEqual([code]);

    const detail = HandoffDetailSchema.parse(
      (await call(app, cookie, "GET", `/v1/admin/handoffs/${code}`)).json(),
    );
    expect(detail.messages.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
    expect(detail.events.map((e) => e.type)).toContain("created");

    const resolved = HandoffDetailSchema.parse(
      (
        await call(app, cookie, "PATCH", `/v1/admin/handoffs/${code}`, { status: "RESOLVED" })
      ).json(),
    );
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.events.at(-1)).toMatchObject({ type: "resolved", actor: agent.id });

    const reopened = HandoffDetailSchema.parse(
      (
        await call(app, cookie, "PATCH", `/v1/admin/handoffs/${code}`, { status: "PENDING" })
      ).json(),
    );
    expect(reopened.events.at(-1)?.type).toBe("reopened");
    expect(reopened.resolvedAt).toBeNull();
  });

  it("paginates 25 at a time", async () => {
    const { app, business, admin } = await setup();
    for (let i = 0; i < 27; i++) await openCase(app, business.publicKey);
    const cookie = await loginAs(app, admin.email);
    const first = HandoffListResponseSchema.parse(
      (await call(app, cookie, "GET", "/v1/admin/handoffs")).json(),
    );
    expect(first.items).toHaveLength(25);
    const second = HandoffListResponseSchema.parse(
      (await call(app, cookie, "GET", `/v1/admin/handoffs?cursor=${first.nextCursor}`)).json(),
    );
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const codes = new Set([...first.items, ...second.items].map((h) => h.code));
    expect(codes.size).toBe(27);
  });

  it("computes metrics per conversation and ignores 'Probar'", async () => {
    const business = await createBusiness(db);
    const admin = await createUser(db, business.id);
    const { app } = makeApp(db, {
      llm: new FakeLlm([answer("Abrimos a las 8."), answer("Hola.")]),
    });

    await postChat(app, { key: business.publicKey, message: "¿Horario?" }); // resolved
    await openCase(app, business.publicKey); // handed off
    const cookie = await loginAs(app, admin.email);
    await call(app, cookie, "POST", "/v1/admin/preview-chat", { message: "persona" }); // preview

    const metrics = MetricsResponseSchema.parse(
      (await call(app, cookie, "GET", "/v1/admin/metrics")).json(),
    );
    expect(metrics).toMatchObject({
      conversations: 2,
      userMessages: 2,
      resolvedByAssistant: 1,
      handedOff: 1,
      resolutionRate: 0.5,
      pendingCount: 1,
      tokens: { input: 120, output: 30, llmCalls: 1 },
    });
    expect(metrics.handoffsByReason.EXPLICIT_REQUEST).toBe(1);
    expect(metrics.recentPending).toHaveLength(1);
  });
});

describe("preview chat", () => {
  it("chats without origin checks, keeps preview cases out of the inbox and sends no e-mail", async () => {
    const business = await createBusiness(db, { allowedDomains: [] });
    const admin = await createUser(db, business.id);
    const { app, mailer } = makeApp(db, { llm: new FakeLlm([answer("Abrimos a las 8.")]) });
    const cookie = await loginAs(app, admin.email);

    const first = ChatResponseSchema.parse(
      (await call(app, cookie, "POST", "/v1/admin/preview-chat", { message: "¿Horario?" })).json(),
    );
    expect(first.reply).toBe("Abrimos a las 8.");
    const second = ChatResponseSchema.parse(
      (
        await call(app, cookie, "POST", "/v1/admin/preview-chat", {
          message: "Quiero un asesor",
          conversationId: first.conversationId,
          conversationToken: first.conversationToken,
        })
      ).json(),
    );
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.handoff?.reason).toBe("EXPLICIT_REQUEST");

    await app.background.drain();
    expect(mailer.sent).toHaveLength(0);
    const list = HandoffListResponseSchema.parse(
      (await call(app, cookie, "GET", "/v1/admin/handoffs")).json(),
    );
    expect(list.items).toHaveLength(0);
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: first.conversationId },
    });
    expect(conversation.isPreview).toBe(true);
  });

  it("never continues a real conversation from the panel", async () => {
    const { app, business, admin } = await setup();
    const real = ChatResponseSchema.parse(
      (await postChat(app, { key: business.publicKey, message: "reclamo" })).json(),
    );
    const cookie = await loginAs(app, admin.email);
    const preview = ChatResponseSchema.parse(
      (
        await call(app, cookie, "POST", "/v1/admin/preview-chat", {
          message: "un asesor",
          conversationId: real.conversationId,
          conversationToken: real.conversationToken,
        })
      ).json(),
    );
    expect(preview.conversationId).not.toBe(real.conversationId);
  });
});

describe("isolation between businesses", () => {
  it("never shows or changes another business's data", async () => {
    const a = await createBusiness(db, { name: "Negocio A" });
    const b = await createBusiness(db, { name: "Negocio B" });
    const adminB = await createUser(db, b.id);
    const { app } = makeApp(db);
    const codeA = await openCase(app, a.publicKey);
    const cookieB = await loginAs(app, adminB.email);

    const business = BusinessResponseSchema.parse(
      (await call(app, cookieB, "GET", "/v1/admin/business")).json(),
    );
    expect(business.name).toBe("Negocio B");
    const list = HandoffListResponseSchema.parse(
      (await call(app, cookieB, "GET", "/v1/admin/handoffs")).json(),
    );
    expect(list.items).toHaveLength(0);
    expect((await call(app, cookieB, "GET", `/v1/admin/handoffs/${codeA}`)).statusCode).toBe(404);
    const patch = await call(app, cookieB, "PATCH", `/v1/admin/handoffs/${codeA}`, {
      status: "RESOLVED",
    });
    expect(patch.statusCode).toBe(404);
    expect((await db.handoff.findFirstOrThrow({ where: { code: codeA } })).status).toBe("PENDING");

    await call(app, cookieB, "PUT", "/v1/admin/knowledge", { items: [] });
    expect(await db.knowledgeItem.count({ where: { businessId: a.id } })).toBe(1);
    const metrics = MetricsResponseSchema.parse(
      (await call(app, cookieB, "GET", "/v1/admin/metrics")).json(),
    );
    expect(metrics.handedOff).toBe(0);
  });

  async function openCase(app: App, key: string) {
    const chat = ChatResponseSchema.parse(
      (await postChat(app, { key, message: "Quiero hablar con una persona" })).json(),
    );
    if (!chat.handoff) throw new Error("expected a handoff");
    return chat.handoff.code;
  }
});
