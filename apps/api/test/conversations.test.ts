/** Panel "Conversaciones" (docs/DECISIONS.md § Conversaciones). */
import {
  ApiErrorResponseSchema,
  ConversationDetailSchema,
  ConversationListResponseSchema,
  type ChatResponse,
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

async function setup() {
  const business = await createBusiness(db);
  const admin = await createUser(db, business.id, "ADMIN");
  const agent = await createUser(db, business.id, "AGENT");
  const llm = new FakeLlm();
  const { app } = makeApp(db, { llm });
  const chat = async (message: string) => {
    llm.push(answer("Respuesta."));
    return JSON.parse(
      (await postChat(app, { key: business.publicKey, message })).body,
    ) as ChatResponse;
  };
  return {
    app,
    business,
    chat,
    admin: await loginAs(app, admin.email),
    agent: await loginAs(app, agent.email),
  };
}

const list = async (app: App, cookie: string, query = "") =>
  ConversationListResponseSchema.parse(
    JSON.parse((await call(app, cookie, "GET", `/v1/admin/conversations${query}`)).body),
  );

describe("GET /v1/admin/conversations", () => {
  it("lists resolved and handed-off conversations, newest first, with language", async () => {
    const { app, business, chat, agent } = await setup();
    const resolved = await chat("¿Cuál es el horario de atención?");
    const handed = JSON.parse(
      (await postChat(app, { key: business.publicKey, message: "Quiero hablar con una persona" }))
        .body,
    ) as ChatResponse;
    const english = await chat("What are your opening hours?");

    const { items } = await list(app, agent);
    expect(items.map((i) => i.id)).toEqual([
      english.conversationId,
      handed.conversationId,
      resolved.conversationId,
    ]);
    expect(items[0]).toMatchObject({ language: "en", handoff: null, userMessages: 1 });
    expect(items[1]?.handoff).toMatchObject({ code: handed.handoff?.code, status: "PENDING" });
    expect(items[2]).toMatchObject({ preview: "¿Cuál es el horario de atención?", language: "es" });

    const onlyResolved = await list(app, agent, "?outcome=resolved");
    expect(onlyResolved.items.map((i) => i.id).sort()).toEqual(
      [resolved.conversationId, english.conversationId].sort(),
    );
    const onlyHanded = await list(app, agent, "?outcome=handed_off");
    expect(onlyHanded.items.map((i) => i.id)).toEqual([handed.conversationId]);
  });

  it("searches message text and case codes", async () => {
    const { app, chat, agent, business } = await setup();
    const granizo = await chat("¿Cubren daños por GRANIZO?");
    await chat("¿Dónde están?");
    const handed = JSON.parse(
      (await postChat(app, { key: business.publicKey, message: "Quiero un asesor" })).body,
    ) as ChatResponse;

    expect((await list(app, agent, "?q=granizo")).items.map((i) => i.id)).toEqual([
      granizo.conversationId,
    ]);
    const code = handed.handoff?.code ?? "";
    expect((await list(app, agent, `?q=${code.toLowerCase()}`)).items.map((i) => i.id)).toEqual([
      handed.conversationId,
    ]);
  });

  it("filters by local day and pages with a cursor", async () => {
    const { app, chat, agent } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 27; i++) ids.push((await chat(`Pregunta ${i}`)).conversationId);
    await db.conversation.update({
      where: { id: ids[0] },
      data: { startedAt: new Date("2026-01-10T15:00:00Z") },
    });

    const first = await list(app, agent);
    expect(first.items).toHaveLength(25);
    const second = await list(app, agent, `?cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();

    const day = await list(app, agent, "?from=2026-01-10&to=2026-01-10");
    expect(day.items.map((i) => i.id)).toEqual([ids[0]]);
  });

  it("leaves out the panel's Probar conversations", async () => {
    const { app, agent } = await setup();
    const preview = await call(app, agent, "POST", "/v1/admin/preview-chat", { message: "hola" });
    expect(preview.statusCode).toBe(200);
    expect((await list(app, agent)).items).toEqual([]);
  });
});

describe("GET /v1/admin/conversations/:id", () => {
  it("returns the whole transcript and its cases", async () => {
    const { app, business, agent } = await setup();
    const res = JSON.parse(
      (await postChat(app, { key: business.publicKey, message: "Quiero hablar con una persona" }))
        .body,
    ) as ChatResponse;
    const detail = ConversationDetailSchema.parse(
      JSON.parse(
        (await call(app, agent, "GET", `/v1/admin/conversations/${res.conversationId}`)).body,
      ),
    );
    expect(detail.messages.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
    expect(detail.handoffs.map((h) => h.code)).toEqual([res.handoff?.code]);
    expect(detail.originDomain).toBe("opticamirador.com");
  });
});

describe("POST /v1/admin/conversations/delete", () => {
  it("deletes conversations with their messages and cases", async () => {
    const { app, business, chat, admin } = await setup();
    const keep = await chat("¿Horario?");
    const gone = JSON.parse(
      (await postChat(app, { key: business.publicKey, message: "Quiero hablar con una persona" }))
        .body,
    ) as ChatResponse;

    const res = await call(app, admin, "POST", "/v1/admin/conversations/delete", {
      ids: [gone.conversationId],
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ deleted: 1 });
    expect((await list(app, admin)).items.map((i) => i.id)).toEqual([keep.conversationId]);
    expect(await db.handoff.count()).toBe(0);
    expect(await db.message.count({ where: { conversationId: gone.conversationId } })).toBe(0);
    expect(
      (await call(app, admin, "GET", `/v1/admin/conversations/${gone.conversationId}`)).statusCode,
    ).toBe(404);
  });

  it("is for admins only", async () => {
    const { app, chat, agent } = await setup();
    const c = await chat("¿Horario?");
    const res = await call(app, agent, "POST", "/v1/admin/conversations/delete", {
      ids: [c.conversationId],
    });
    expect(res.statusCode).toBe(403);
    expect(await db.conversation.count()).toBe(1);
  });

  it("rejects malformed ids", async () => {
    const { app, admin } = await setup();
    const res = await call(app, admin, "POST", "/v1/admin/conversations/delete", {
      ids: ["DROP TABLE"],
    });
    expect(res.statusCode).toBe(400);
    expect(ApiErrorResponseSchema.parse(JSON.parse(res.body)).error.code).toBe("invalid_request");
  });
});
