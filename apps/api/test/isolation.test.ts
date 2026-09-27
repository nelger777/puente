/**
 * Milestone 5 acceptance: two businesses side by side; nothing of one is reachable,
 * listable or changeable from the other, on any public or panel route.
 */
import {
  BusinessResponseSchema,
  ChatResponseSchema,
  HandoffListResponseSchema,
  KnowledgeResponseSchema,
  MetricsResponseSchema,
} from "@puente/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
type App = ReturnType<typeof makeApp>["app"];

interface Tenant {
  key: string;
  businessId: string;
  cookie: string;
  conversationId: string;
  conversationToken: string;
  code: string;
}

let app: App;
let a: Tenant;
let b: Tenant;

async function tenant(name: string, domain: string): Promise<Tenant> {
  const business = await createBusiness(db, { name, allowedDomains: [domain] });
  const admin = await createUser(db, business.id, "ADMIN");
  await postChat(app, { key: business.publicKey, message: "¿Horario?" }, `https://${domain}`);
  const chat = ChatResponseSchema.parse(
    (
      await postChat(
        app,
        { key: business.publicKey, message: "Quiero hablar con una persona" },
        `https://${domain}`,
      )
    ).json(),
  );
  if (!chat.handoff) throw new Error("expected a handoff");
  return {
    key: business.publicKey,
    businessId: business.id,
    cookie: await loginAs(app, admin.email),
    conversationId: chat.conversationId,
    conversationToken: chat.conversationToken,
    code: chat.handoff.code,
  };
}

function panel(
  cookie: string,
  method: "GET" | "PUT" | "PATCH" | "POST",
  url: string,
  payload?: object,
) {
  return app.inject({
    method,
    url,
    headers: { cookie, origin: PANEL_ORIGIN },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
}

beforeAll(async () => {
  await resetDb(db);
  ({ app } = makeApp(db, { llm: new FakeLlm([answer("A las 8."), answer("A las 9.")]) }));
  a = await tenant("Negocio A", "negocio-a.com");
  b = await tenant("Negocio B", "negocio-b.com");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("public widget API", () => {
  it("does not serve A's widget on B's domain", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/widget/config?key=${a.key}`,
      headers: { origin: "https://negocio-b.com" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("does not continue A's conversation with B's key", async () => {
    const chat = ChatResponseSchema.parse(
      (
        await postChat(
          app,
          {
            key: b.key,
            message: "hola",
            conversationId: a.conversationId,
            conversationToken: a.conversationToken,
          },
          "https://negocio-b.com",
        )
      ).json(),
    );
    expect(chat.conversationId).not.toBe(a.conversationId);
    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: a.conversationId } })).businessId,
    ).toBe(a.businessId);
  });

  it.each(["contact", "events"])("does not accept %s for A's case with B's key", async (action) => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/handoffs/${a.code}/${action}`,
      headers: { origin: "https://negocio-b.com" },
      payload: {
        key: b.key,
        conversationToken: a.conversationToken,
        type: "whatsapp_opened",
        phone: "0981000000",
        consent: true,
      },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("panel API", () => {
  it("shows B only its own business, knowledge, cases and metrics", async () => {
    const business = BusinessResponseSchema.parse(
      (await panel(b.cookie, "GET", "/v1/admin/business")).json(),
    );
    expect(business.id).toBe(b.businessId);

    const knowledge = KnowledgeResponseSchema.parse(
      (await panel(b.cookie, "GET", "/v1/admin/knowledge")).json(),
    );
    const ownIds = (await db.knowledgeItem.findMany({ where: { businessId: b.businessId } })).map(
      (k) => k.id,
    );
    expect(knowledge.items.map((k) => k.id).sort()).toEqual(ownIds.sort());

    // Compare with what the database holds for B (other tests here add B cases too).
    const ownCodes = (await db.handoff.findMany({ where: { businessId: b.businessId } }))
      .map((h) => h.code)
      .sort();
    expect(ownCodes).toContain(b.code);

    const list = HandoffListResponseSchema.parse(
      (await panel(b.cookie, "GET", "/v1/admin/handoffs")).json(),
    );
    expect(list.items.map((h) => h.code).sort()).toEqual(ownCodes);
    expect(list.pendingCount).toBe(ownCodes.length);

    const metrics = MetricsResponseSchema.parse(
      (await panel(b.cookie, "GET", "/v1/admin/metrics")).json(),
    );
    expect(metrics.handedOff).toBe(ownCodes.length);
    expect(metrics.recentPending.map((h) => h.code).sort()).toEqual(ownCodes);
  });

  it("does not let B read or change A's case, even with A's cursor", async () => {
    expect((await panel(b.cookie, "GET", `/v1/admin/handoffs/${a.code}`)).statusCode).toBe(404);
    expect(
      (await panel(b.cookie, "PATCH", `/v1/admin/handoffs/${a.code}`, { status: "RESOLVED" }))
        .statusCode,
    ).toBe(404);
    expect((await db.handoff.findUniqueOrThrow({ where: { code: a.code } })).status).toBe(
      "PENDING",
    );

    const aHandoff = await db.handoff.findUniqueOrThrow({ where: { code: a.code } });
    const page = await panel(b.cookie, "GET", `/v1/admin/handoffs?cursor=${aHandoff.id}`);
    const items = page.statusCode === 200 ? HandoffListResponseSchema.parse(page.json()).items : [];
    expect(items.map((h) => h.code)).not.toContain(a.code);
  });

  it("changes only B's data when B saves settings or knowledge", async () => {
    const before = await db.business.findUniqueOrThrow({ where: { id: a.businessId } });
    const current = BusinessResponseSchema.parse(
      (await panel(b.cookie, "GET", "/v1/admin/business")).json(),
    );
    const { id: _id, slug: _slug, publicKey: _pk, widgetScriptUrl: _url, ...settings } = current;
    await panel(b.cookie, "PUT", "/v1/admin/business", { ...settings, botName: "Solo B" });
    await panel(b.cookie, "PUT", "/v1/admin/knowledge", { items: [] });

    const after = await db.business.findUniqueOrThrow({ where: { id: a.businessId } });
    expect(after.botName).toBe(before.botName);
    expect(await db.knowledgeItem.count({ where: { businessId: a.businessId } })).toBe(1);
    expect((await db.business.findUniqueOrThrow({ where: { id: b.businessId } })).botName).toBe(
      "Solo B",
    );
  });

  it("never lets B's preview continue A's conversation", async () => {
    const res = ChatResponseSchema.parse(
      (
        await panel(b.cookie, "POST", "/v1/admin/preview-chat", {
          message: "un asesor",
          conversationId: a.conversationId,
          conversationToken: a.conversationToken,
        })
      ).json(),
    );
    expect(res.conversationId).not.toBe(a.conversationId);
  });

  it("scopes the session to its own business", async () => {
    const me = (await panel(a.cookie, "GET", "/v1/auth/me")).json<{ business: { id: string } }>();
    expect(me.business.id).toBe(a.businessId);
  });
});
