/** Knowledge base categories and versions (docs/DECISIONS.md § Base de conocimiento). */
import {
  ApiErrorResponseSchema,
  KnowledgeResponseSchema,
  KnowledgeVersionListSchema,
} from "@puente/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/engine/prompt";
import {
  answer,
  createBusiness,
  createUser,
  FakeLlm,
  handoffAnswer,
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

function call(
  app: App,
  cookie: string,
  method: "GET" | "PUT" | "POST",
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
  const business = await createBusiness(db); // starts with "¿Cuál es el horario?"
  const admin = await createUser(db, business.id, "ADMIN");
  const agent = await createUser(db, business.id, "AGENT");
  const llm = new FakeLlm();
  const { app } = makeApp(db, { llm });
  return {
    app,
    llm,
    business,
    admin: await loginAs(app, admin.email),
    adminEmail: admin.email,
    agent: await loginAs(app, agent.email),
  };
}

const save = async (app: App, cookie: string, items: unknown[]) =>
  KnowledgeResponseSchema.parse(
    JSON.parse((await call(app, cookie, "PUT", "/v1/admin/knowledge", { items })).body),
  ).items;

const versions = async (app: App, cookie: string) =>
  KnowledgeVersionListSchema.parse(
    JSON.parse((await call(app, cookie, "GET", "/v1/admin/knowledge/versions")).body),
  ).versions;

describe("categories", () => {
  it("saves and returns a category per question; blank means none", async () => {
    const { app, admin } = await setup();
    const items = await save(app, admin, [
      { question: "¿Cubren granizo?", answer: "Sí.", category: "  Autos " },
      { question: "¿Horario?", answer: "8 a 18.", category: "" },
      { question: "¿Dónde?", answer: "Centro." },
    ]);
    expect(items.map((i) => i.category)).toEqual(["Autos", null, null]);
  });

  it("rejects a category over 40 characters", async () => {
    const { app, admin } = await setup();
    const res = await call(app, admin, "PUT", "/v1/admin/knowledge", {
      items: [{ question: "P", answer: "R", category: "x".repeat(41) }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("shows the category to the model", () => {
    const prompt = buildSystemPrompt(
      { botName: "Laura", name: "La Rural", kind: "seguros", sensitiveTopics: [], voice: "vos" },
      [
        { question: "¿Cubren granizo?", answer: "Sí.", category: "Autos" },
        { question: "¿Horario?", answer: "8 a 18.", category: null },
      ],
    );
    expect(prompt).toContain("1. [Autos] P: ¿Cubren granizo?\n   R: Sí.");
    expect(prompt).toContain("2. P: ¿Horario?\n   R: 8 a 18.");
  });
});

describe("versions", () => {
  it("keeps the base a save replaced, newest first, with who replaced it", async () => {
    const { app, admin, adminEmail } = await setup();
    await save(app, admin, [{ question: "Uno", answer: "1" }]);
    await save(app, admin, [
      { question: "Dos", answer: "2" },
      { question: "Tres", answer: "3" },
    ]);

    const list = await versions(app, admin);
    expect(list.map((v) => v.itemCount)).toEqual([1, 1]);
    expect(list[0]?.replacedBy).toBe(adminEmail);
    const stored = await db.knowledgeVersion.findUniqueOrThrow({ where: { id: list[0]?.id } });
    expect(stored.items).toEqual([{ question: "Uno", answer: "1", category: null }]);
  });

  it("does not keep a version when the save changes nothing", async () => {
    const { app, admin } = await setup();
    await save(app, admin, [{ question: "Uno", answer: "1", category: "A" }]);
    await save(app, admin, [{ question: "Uno", answer: "1", category: "A" }]);
    expect(await versions(app, admin)).toHaveLength(1);
  });

  it("keeps only the last 10", async () => {
    const { app, admin } = await setup();
    for (let i = 0; i < 12; i++) await save(app, admin, [{ question: `P${i}`, answer: "R" }]);
    expect(await versions(app, admin)).toHaveLength(10);
    expect(await db.knowledgeVersion.count()).toBe(10);
  });

  it("restores a version, and the restore itself can be undone", async () => {
    const { app, admin } = await setup();
    await save(app, admin, [{ question: "Nueva", answer: "N", category: "X" }]);
    const [original] = await versions(app, admin); // the seed base, before "Nueva"

    const res = await call(
      app,
      admin,
      "POST",
      `/v1/admin/knowledge/versions/${original?.id}/restore`,
    );
    expect(res.statusCode).toBe(200);
    const restored = KnowledgeResponseSchema.parse(JSON.parse(res.body)).items;
    expect(restored.map((i) => i.question)).toEqual(["¿Cuál es el horario?"]);

    const [undo] = await versions(app, admin);
    const back = KnowledgeResponseSchema.parse(
      JSON.parse(
        (await call(app, admin, "POST", `/v1/admin/knowledge/versions/${undo?.id}/restore`)).body,
      ),
    ).items;
    expect(back.map((i) => [i.question, i.category])).toEqual([["Nueva", "X"]]);
  });

  it("keeps a version when Sin respuesta adds a question", async () => {
    const { app, llm, business, admin } = await setup();
    llm.push(answer("¡Hola!"), handoffAnswer("sin_informacion"));
    const first = JSON.parse(
      (await postChat(app, { key: business.publicKey, message: "Hola" })).body,
    ) as {
      conversationId: string;
      conversationToken: string;
    };
    const res = JSON.parse(
      (await postChat(app, { key: business.publicKey, message: "¿Venden motos?", ...first })).body,
    ) as { handoff: { code: string } };

    await call(app, admin, "POST", "/v1/admin/unanswered/knowledge", {
      codes: [res.handoff.code],
      item: { question: "¿Venden motos?", answer: "No.", category: "Ventas" },
    });
    expect((await versions(app, admin)).map((v) => v.itemCount)).toEqual([1]);
    const kb = await db.knowledgeItem.findMany({ orderBy: { position: "asc" } });
    expect(kb.at(-1)).toMatchObject({ question: "¿Venden motos?", category: "Ventas" });
  });

  it("is for admins, and only for the business's own versions", async () => {
    const { app, admin, agent } = await setup();
    await save(app, admin, [{ question: "Uno", answer: "1" }]);
    const [mine] = await versions(app, admin);
    expect((await call(app, agent, "GET", "/v1/admin/knowledge/versions")).statusCode).toBe(403);

    const other = await createBusiness(db, { name: "Otro", slug: "otro" });
    const outsider = await loginAs(app, (await createUser(db, other.id, "ADMIN")).email);
    expect(await versions(app, outsider)).toEqual([]);
    const res = await call(
      app,
      outsider,
      "POST",
      `/v1/admin/knowledge/versions/${mine?.id}/restore`,
    );
    expect(res.statusCode).toBe(404);
    expect(ApiErrorResponseSchema.parse(JSON.parse(res.body)).error.code).toBe("not_found");
    expect(await db.knowledgeItem.count({ where: { businessId: other.id } })).toBe(1);
  });
});
