/** Own password change and "Sin respuesta" (docs/DECISIONS.md § Mi cuenta y preguntas sin respuesta). */
import {
  ApiErrorResponseSchema,
  KnowledgeResponseSchema,
  UnansweredListResponseSchema,
} from "@puente/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  answer,
  createBusiness,
  createUser,
  FakeLlm,
  handoffAnswer,
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

function call(app: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { cookie, origin: PANEL_ORIGIN },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

const errorCode = (body: string) => ApiErrorResponseSchema.parse(JSON.parse(body)).error.code;

describe("POST /v1/auth/password", () => {
  async function setup() {
    const business = await createBusiness(db);
    const user = await createUser(db, business.id, "AGENT");
    const { app } = makeApp(db);
    const cookie = await loginAs(app, user.email);
    const other = await loginAs(app, user.email);
    return { app, user, cookie, other };
  }

  it("changes the password, keeps this session and closes the others", async () => {
    const { app, user, cookie, other } = await setup();
    const res = await call(app, cookie, "POST", "/v1/auth/password", {
      currentPassword: PASSWORD,
      newPassword: "una-clave-nueva-larga",
    });
    expect(res.statusCode).toBe(204);

    expect((await call(app, cookie, "GET", "/v1/auth/me")).statusCode).toBe(200);
    expect((await call(app, other, "GET", "/v1/auth/me")).statusCode).toBe(401);

    const login = (password: string) =>
      app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { origin: PANEL_ORIGIN },
        payload: { email: user.email, password },
      });
    expect((await login(PASSWORD)).statusCode).toBe(401);
    expect((await login("una-clave-nueva-larga")).statusCode).toBe(200);
  });

  it("rejects a wrong current password without logging the user out", async () => {
    const { app, cookie, other } = await setup();
    const res = await call(app, cookie, "POST", "/v1/auth/password", {
      currentPassword: "no-es-esta",
      newPassword: "una-clave-nueva-larga",
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res.body)).toBe("wrong_password");
    expect((await call(app, cookie, "GET", "/v1/auth/me")).statusCode).toBe(200);
    expect((await call(app, other, "GET", "/v1/auth/me")).statusCode).toBe(200);
  });

  it.each([
    ["too short", "corta"],
    ["same as the current one", PASSWORD],
  ])("rejects a new password that is %s", async (_label, newPassword) => {
    const { app, cookie } = await setup();
    const res = await call(app, cookie, "POST", "/v1/auth/password", {
      currentPassword: PASSWORD,
      newPassword,
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res.body)).toBe("invalid_request");
  });

  it("requires a session", async () => {
    const { app } = makeApp(db);
    const res = await call(app, "", "POST", "/v1/auth/password", {
      currentPassword: PASSWORD,
      newPassword: "una-clave-nueva-larga",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Sin respuesta", () => {
  /** One real conversation per question: an answered turn, then a NO_INFORMATION handoff. */
  async function askUnanswered(app: App, key: string, question: string) {
    const first = JSON.parse((await postChat(app, { key, message: "Hola" })).body) as {
      conversationId: string;
      conversationToken: string;
    };
    const res = await postChat(app, {
      key,
      message: question,
      conversationId: first.conversationId,
      conversationToken: first.conversationToken,
    });
    return (JSON.parse(res.body) as { handoff: { code: string } }).handoff.code;
  }

  async function setup() {
    const business = await createBusiness(db);
    const admin = await createUser(db, business.id, "ADMIN");
    const agent = await createUser(db, business.id, "AGENT");
    const llm = new FakeLlm();
    const { app } = makeApp(db, { llm });
    const scripted = (n: number) => {
      for (let i = 0; i < n; i++) llm.push(answer("¡Hola!"), handoffAnswer("sin_informacion"));
    };
    return {
      app,
      business,
      scripted,
      admin: await loginAs(app, admin.email),
      agent: await loginAs(app, agent.email),
    };
  }

  const list = async (app: App, cookie: string) =>
    UnansweredListResponseSchema.parse(
      JSON.parse((await call(app, cookie, "GET", "/v1/admin/unanswered")).body),
    ).items;

  it("lists the customer's question, grouping repeats, newest first", async () => {
    const { app, business, scripted, admin } = await setup();
    scripted(3);
    const a1 = await askUnanswered(app, business.publicKey, "¿Cubren granizo?");
    const b = await askUnanswered(app, business.publicKey, "Do you insure boats?");
    const a2 = await askUnanswered(app, business.publicKey, "cubren granizo");

    const items = await list(app, admin);
    expect(items.map((i) => i.question)).toEqual(["cubren granizo", "Do you insure boats?"]);
    expect(items[0]?.codes).toEqual([a2, a1]);
    expect(items[1]).toMatchObject({ codes: [b], summary: "El cliente necesita ayuda." });
  });

  it("adds the answer at the end of the base and closes the group", async () => {
    const { app, business, scripted, admin } = await setup();
    scripted(1);
    const code = await askUnanswered(app, business.publicKey, "¿Cubren granizo?");

    const res = await call(app, admin, "POST", "/v1/admin/unanswered/knowledge", {
      codes: [code],
      item: { question: "¿Cubren daños por granizo?", answer: "Sí, en la cobertura total." },
    });
    expect(res.statusCode).toBe(200);
    const kb = KnowledgeResponseSchema.parse(JSON.parse(res.body)).items;
    expect(kb.map((k) => [k.question, k.position])).toEqual([
      ["¿Cuál es el horario?", 0],
      ["¿Cubren daños por granizo?", 1],
    ]);
    expect(await list(app, admin)).toEqual([]);

    const detail = JSON.parse(
      (await call(app, admin, "GET", `/v1/admin/handoffs/${code}`)).body,
    ) as { events: { type: string }[] };
    expect(detail.events.map((e) => e.type)).toContain("knowledge_added");
  });

  it("dismisses a group without touching the base", async () => {
    const { app, business, scripted, admin } = await setup();
    scripted(1);
    const code = await askUnanswered(app, business.publicKey, "¿Venden autos?");
    const res = await call(app, admin, "POST", "/v1/admin/unanswered/dismiss", { codes: [code] });
    expect(res.statusCode).toBe(204);
    expect(await list(app, admin)).toEqual([]);
    expect(await db.knowledgeItem.count()).toBe(1);
  });

  it("refuses a full base and leaves the group open", async () => {
    const { app, business, scripted, admin } = await setup();
    // createBusiness already has one question: 199 more fill the base.
    await db.knowledgeItem.createMany({
      data: Array.from({ length: 199 }, (_, i) => ({
        id: `kb_${i}`,
        businessId: business.id,
        question: `P${i}`,
        answer: `R${i}`,
        position: i + 1,
      })),
    });
    scripted(1);
    const code = await askUnanswered(app, business.publicKey, "¿Cubren granizo?");
    const res = await call(app, admin, "POST", "/v1/admin/unanswered/knowledge", {
      codes: [code],
      item: { question: "¿Granizo?", answer: "Sí." },
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res.body)).toBe("knowledge_full");
    expect(await list(app, admin)).toHaveLength(1);
  });

  it("is for admins, and only for the business's own cases", async () => {
    const { app, business, scripted, admin, agent } = await setup();
    scripted(1);
    const code = await askUnanswered(app, business.publicKey, "¿Cubren granizo?");
    expect((await call(app, agent, "GET", "/v1/admin/unanswered")).statusCode).toBe(403);

    const other = await createBusiness(db, { name: "Otro", slug: "otro" });
    const outsider = await loginAs(app, (await createUser(db, other.id, "ADMIN")).email);
    expect(await list(app, outsider)).toEqual([]);
    const res = await call(app, outsider, "POST", "/v1/admin/unanswered/dismiss", {
      codes: [code],
    });
    expect(res.statusCode).toBe(404);
    expect(await list(app, admin)).toHaveLength(1);
  });
});
