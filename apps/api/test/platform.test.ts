/**
 * Businesses managed by the platform operator, and users managed inside each business
 * (docs/DECISIONS.md § Empresas).
 */
import {
  BusinessCreateResponseSchema,
  BusinessResponseSchema,
  MeResponseSchema,
  PlatformBusinessListSchema,
  UserListResponseSchema,
  UserWithPasswordSchema,
} from "@puente/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBusiness,
  createUser,
  loginAs,
  makeApp,
  PANEL_ORIGIN,
  PASSWORD,
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

function login(app: App, email: string, password: string) {
  return app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin: PANEL_ORIGIN },
    payload: { email, password },
  });
}

const NEW_BUSINESS = {
  name: "Ferretería Sol",
  slug: "ferreteria-sol",
  kind: "ferretería",
  whatsappNumber: "595981222333",
  notifyEmail: "avisos@ferreteriasol.com",
  allowedDomains: ["ferreteriasol.com"],
  adminEmail: "Duenio@FerreteriaSol.com",
};

/** Business A with its ADMIN and AGENT, plus the operator, whose own account lives in A. */
async function setup() {
  const home = await createBusiness(db, { name: "Negocio A", slug: "negocio-a" });
  const admin = await createUser(db, home.id, "ADMIN");
  const agent = await createUser(db, home.id, "AGENT");
  const operator = await createUser(db, home.id, "ADMIN", "operador@puente.test");
  await db.user.update({ where: { id: operator.id }, data: { isPlatformAdmin: true } });
  const { app } = makeApp(db);
  return {
    app,
    home,
    admin,
    agent,
    operator,
    adminCookie: await loginAs(app, admin.email),
    agentCookie: await loginAs(app, agent.email),
    operatorCookie: await loginAs(app, operator.email),
  };
}

describe("platform guard", () => {
  it("rejects every platform route for a business ADMIN or AGENT", async () => {
    const { app, adminCookie, agentCookie, home } = await setup();
    for (const cookie of [adminCookie, agentCookie]) {
      expect((await call(app, cookie, "GET", "/v1/platform/businesses")).statusCode).toBe(403);
      expect(
        (await call(app, cookie, "POST", "/v1/platform/businesses", NEW_BUSINESS)).statusCode,
      ).toBe(403);
      expect(
        (await call(app, cookie, "POST", "/v1/platform/act-as", { businessId: home.id }))
          .statusCode,
      ).toBe(403);
    }
    expect(await db.business.count()).toBe(1);
  });

  it("requires a session", async () => {
    const { app } = await setup();
    expect((await call(app, "", "GET", "/v1/platform/businesses")).statusCode).toBe(401);
  });

  it("reports the flag in /auth/me only for the operator", async () => {
    const { app, adminCookie, operatorCookie } = await setup();
    const me = (cookie: string) =>
      call(app, cookie, "GET", "/v1/auth/me").then((r) => MeResponseSchema.parse(r.json()));
    expect((await me(adminCookie)).user.platformAdmin).toBe(false);
    expect((await me(operatorCookie)).user.platformAdmin).toBe(true);
  });
});

describe("creating a business", () => {
  it("creates the business with defaults and an ADMIN who can log in with the shown password", async () => {
    const { app, operatorCookie } = await setup();
    const res = await call(app, operatorCookie, "POST", "/v1/platform/businesses", NEW_BUSINESS);
    expect(res.statusCode).toBe(201);
    const created = BusinessCreateResponseSchema.parse(res.json());
    expect(created.business).toMatchObject({ slug: "ferreteria-sol", active: true, users: 1 });
    expect(created.admin).toMatchObject({ email: "duenio@ferreteriasol.com", role: "ADMIN" });
    expect(created.password).toHaveLength(16);

    const stored = await db.user.findUniqueOrThrow({ where: { email: created.admin.email } });
    expect(stored.passwordHash).not.toContain(created.password);

    const ownerLogin = await login(app, created.admin.email, created.password);
    expect(ownerLogin.statusCode).toBe(200);
    const me = MeResponseSchema.parse(ownerLogin.json());
    expect(me.business.id).toBe(created.business.id);
    expect(me.user.platformAdmin).toBe(false);

    // The widget works on the new business's domain right away.
    const business = await db.business.findUniqueOrThrow({ where: { id: created.business.id } });
    const widget = await app.inject({
      method: "GET",
      url: `/v1/widget/config?key=${business.publicKey}`,
      headers: { origin: "https://ferreteriasol.com" },
    });
    expect(widget.statusCode).toBe(200);
  });

  it("refuses a taken slug or e-mail without creating anything", async () => {
    const { app, operatorCookie, home, admin } = await setup();
    const slug = await call(app, operatorCookie, "POST", "/v1/platform/businesses", {
      ...NEW_BUSINESS,
      slug: home.slug,
    });
    expect(slug.statusCode).toBe(409);
    expect(slug.json()).toMatchObject({ error: { code: "slug_taken" } });

    const email = await call(app, operatorCookie, "POST", "/v1/platform/businesses", {
      ...NEW_BUSINESS,
      adminEmail: admin.email,
    });
    expect(email.statusCode).toBe(409);
    expect(email.json()).toMatchObject({ error: { code: "email_taken" } });
    expect(await db.business.count()).toBe(1);
  });

  it("validates the input", async () => {
    const { app, operatorCookie } = await setup();
    const res = await call(app, operatorCookie, "POST", "/v1/platform/businesses", {
      ...NEW_BUSINESS,
      slug: "Con Espacios",
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists businesses with users (without the operator) and this month's conversations", async () => {
    const { app, operatorCookie, home } = await setup();
    await call(app, operatorCookie, "POST", "/v1/platform/businesses", NEW_BUSINESS);
    await db.usageMonth.create({
      data: { businessId: home.id, month: new Date().toISOString().slice(0, 7), conversations: 7 },
    });
    const list = PlatformBusinessListSchema.parse(
      (await call(app, operatorCookie, "GET", "/v1/platform/businesses")).json(),
    );
    expect(list.businesses.map((b) => [b.name, b.users])).toEqual([
      ["Ferretería Sol", 1],
      ["Negocio A", 2],
    ]);
    expect(list.businesses.find((b) => b.id === home.id)?.conversationsThisMonth).toBe(7);
  });
});

describe("entering a business", () => {
  it("scopes every panel route to the entered business, as its ADMIN, until going back", async () => {
    const { app, operatorCookie, agentCookie, home } = await setup();
    const other = await createBusiness(db, { name: "Negocio B" });
    await createUser(db, other.id, "ADMIN", "admin@negociob.test");

    const entered = await call(app, operatorCookie, "POST", "/v1/platform/act-as", {
      businessId: other.id,
    });
    expect(MeResponseSchema.parse(entered.json())).toMatchObject({
      user: { role: "ADMIN", platformAdmin: true },
      business: { id: other.id, name: "Negocio B" },
    });

    const business = BusinessResponseSchema.parse(
      (await call(app, operatorCookie, "GET", "/v1/admin/business")).json(),
    );
    expect(business.id).toBe(other.id);
    const {
      id: _id,
      slug: _s,
      publicKey: _k,
      widgetScriptUrl: _w,
      avatarUrl: _a,
      llm: _l,
      ...settings
    } = business;
    expect(
      (
        await call(app, operatorCookie, "PUT", "/v1/admin/business", {
          ...settings,
          botName: "Bruno",
        })
      ).statusCode,
    ).toBe(200);
    expect((await db.business.findUniqueOrThrow({ where: { id: other.id } })).botName).toBe(
      "Bruno",
    );
    expect((await db.business.findUniqueOrThrow({ where: { id: home.id } })).botName).toBe("Luz");

    const users = UserListResponseSchema.parse(
      (await call(app, operatorCookie, "GET", "/v1/admin/users")).json(),
    );
    expect(users.users.map((u) => u.email)).toEqual(["admin@negociob.test"]);

    // Other sessions of the same business are not affected.
    const agentMe = MeResponseSchema.parse(
      (await call(app, agentCookie, "GET", "/v1/auth/me")).json(),
    );
    expect(agentMe.business.id).toBe(home.id);

    const back = await call(app, operatorCookie, "POST", "/v1/platform/act-as", {
      businessId: null,
    });
    expect(MeResponseSchema.parse(back.json()).business.id).toBe(home.id);
  });

  it("answers 404 for an unknown business", async () => {
    const { app, operatorCookie } = await setup();
    const res = await call(app, operatorCookie, "POST", "/v1/platform/act-as", {
      businessId: "biz_missing",
    });
    expect(res.statusCode).toBe(404);
  });

  it("ignores an entered business once the platform flag is removed", async () => {
    const { app, operatorCookie, operator, home } = await setup();
    const other = await createBusiness(db, { name: "Negocio B" });
    await call(app, operatorCookie, "POST", "/v1/platform/act-as", { businessId: other.id });
    await db.user.update({ where: { id: operator.id }, data: { isPlatformAdmin: false } });
    const me = MeResponseSchema.parse(
      (await call(app, operatorCookie, "GET", "/v1/auth/me")).json(),
    );
    expect(me.business.id).toBe(home.id);
    expect(me.user.platformAdmin).toBe(false);
  });
});

describe("users of a business", () => {
  it("lets an ADMIN add a user who logs in with the shown password; AGENTs cannot manage users", async () => {
    const { app, adminCookie, agentCookie } = await setup();
    const res = await call(app, adminCookie, "POST", "/v1/admin/users", {
      email: "nuevo@negocioa.test",
      role: "AGENT",
    });
    expect(res.statusCode).toBe(201);
    const created = UserWithPasswordSchema.parse(res.json());
    expect((await login(app, "nuevo@negocioa.test", created.password)).statusCode).toBe(200);

    expect((await call(app, agentCookie, "GET", "/v1/admin/users")).statusCode).toBe(403);
    expect(
      (await call(app, agentCookie, "POST", "/v1/admin/users", { email: "x@y.com", role: "ADMIN" }))
        .statusCode,
    ).toBe(403);
  });

  it("refuses an e-mail already in use, in any business", async () => {
    const { app, adminCookie } = await setup();
    const other = await createBusiness(db, { name: "Negocio B" });
    await createUser(db, other.id, "AGENT", "ocupado@negociob.test");
    const res = await call(app, adminCookie, "POST", "/v1/admin/users", {
      email: "ocupado@negociob.test",
      role: "AGENT",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: "email_taken" } });
  });

  it("hides the operator from the business it belongs to", async () => {
    const { app, adminCookie, operator } = await setup();
    const users = UserListResponseSchema.parse(
      (await call(app, adminCookie, "GET", "/v1/admin/users")).json(),
    );
    expect(users.users.map((u) => u.id)).not.toContain(operator.id);
    const res = await call(app, adminCookie, "PATCH", `/v1/admin/users/${operator.id}`, {
      active: false,
    });
    expect(res.statusCode).toBe(404);
  });

  it("does not reach users of another business", async () => {
    const { app, adminCookie } = await setup();
    const other = await createBusiness(db, { name: "Negocio B" });
    const stranger = await createUser(db, other.id, "AGENT");
    expect(
      (await call(app, adminCookie, "PATCH", `/v1/admin/users/${stranger.id}`, { role: "ADMIN" }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(app, adminCookie, "POST", `/v1/admin/users/${stranger.id}/reset-password`))
        .statusCode,
    ).toBe(404);
    expect((await db.user.findUniqueOrThrow({ where: { id: stranger.id } })).role).toBe("AGENT");
  });

  it("does not let an ADMIN change or reset themselves", async () => {
    const { app, adminCookie, admin } = await setup();
    const patch = await call(app, adminCookie, "PATCH", `/v1/admin/users/${admin.id}`, {
      role: "AGENT",
    });
    expect(patch.json()).toMatchObject({ error: { code: "cannot_change_self" } });
    const reset = await call(
      app,
      adminCookie,
      "POST",
      `/v1/admin/users/${admin.id}/reset-password`,
    );
    expect(reset.json()).toMatchObject({ error: { code: "cannot_change_self" } });
  });

  it("always keeps one active ADMIN in the business", async () => {
    const { app, operatorCookie, admin, home } = await setup();
    await call(app, operatorCookie, "POST", "/v1/platform/act-as", { businessId: home.id });
    const res = await call(app, operatorCookie, "PATCH", `/v1/admin/users/${admin.id}`, {
      role: "AGENT",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: "last_admin" } });
  });

  it("logs a disabled user out and keeps them out until enabled again", async () => {
    const { app, adminCookie, agent, agentCookie } = await setup();
    expect(
      (await call(app, adminCookie, "PATCH", `/v1/admin/users/${agent.id}`, { active: false }))
        .statusCode,
    ).toBe(200);
    expect((await call(app, agentCookie, "GET", "/v1/auth/me")).statusCode).toBe(401);
    const denied = await login(app, agent.email, PASSWORD);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: "user_disabled" } });

    await call(app, adminCookie, "PATCH", `/v1/admin/users/${agent.id}`, { active: true });
    expect((await login(app, agent.email, PASSWORD)).statusCode).toBe(200);
  });

  it("resets a password: the old one and its sessions stop working", async () => {
    const { app, adminCookie, agent, agentCookie } = await setup();
    await db.user.update({
      where: { id: agent.id },
      data: { lockedUntil: new Date(Date.now() + 60_000) },
    });
    const res = await call(app, adminCookie, "POST", `/v1/admin/users/${agent.id}/reset-password`);
    const { password } = UserWithPasswordSchema.parse(res.json());
    expect((await call(app, agentCookie, "GET", "/v1/auth/me")).statusCode).toBe(401);
    expect((await login(app, agent.email, PASSWORD)).statusCode).toBe(401);
    expect((await login(app, agent.email, password)).statusCode).toBe(200);
  });
});

describe("usage and quota", () => {
  /** One real conversation this month: a customer message, a priced reply and a pending case. */
  async function activity(businessId: string, now = new Date()) {
    const conversationId = `conv_${businessId.slice(4)}x`;
    await db.conversation.create({
      data: {
        id: conversationId,
        businessId,
        tokenHash: "x",
        visitorId: "v",
        originDomain: "negocio-a.com",
        userMessageCount: 1,
        startedAt: now,
        lastMessageAt: now,
      },
    });
    await db.message.createMany({
      data: [
        {
          id: `msg_${conversationId}u`,
          conversationId,
          role: "USER",
          content: "Hola",
          createdAt: now,
        },
        {
          id: `msg_${conversationId}a`,
          conversationId,
          role: "ASSISTANT",
          content: "¡Hola!",
          engine: "llm",
          inputTokens: 1_000_000,
          outputTokens: 200_000,
          createdAt: now,
        },
      ],
    });
    await db.handoff.create({
      data: {
        id: `hof_${conversationId}`,
        code: "DER-7777",
        businessId,
        conversationId,
        reason: "EXPLICIT_REQUEST",
        summary: "s",
        waMessage: "w",
        openedInHours: true,
      },
    });
  }

  it("lists this month's messages, AI cost, engine and pending cases per business", async () => {
    const { app, home, operatorCookie } = await setup();
    await activity(home.id);
    const list = PlatformBusinessListSchema.parse(
      (await call(app, operatorCookie, "GET", "/v1/platform/businesses")).json(),
    );
    // TEST_ENV prices: 1 USD per million input tokens, 5 per million output.
    expect(list.businesses[0]).toMatchObject({
      messagesThisMonth: 1,
      costThisMonthUsd: 2,
      llmProvider: "default",
      pendingHandoffs: 1,
    });
  });

  it("prices free Gemini at zero", async () => {
    const { app, home, operatorCookie } = await setup();
    await db.business.update({ where: { id: home.id }, data: { llmProvider: "gemini" } });
    await activity(home.id);
    const list = PlatformBusinessListSchema.parse(
      (await call(app, operatorCookie, "GET", "/v1/platform/businesses")).json(),
    );
    expect(list.businesses[0]).toMatchObject({ costThisMonthUsd: 0, llmProvider: "gemini" });
  });

  it("sets and clears the monthly quota, re-arming this month's alerts", async () => {
    const { app, home, operatorCookie } = await setup();
    const month = new Intl.DateTimeFormat("en-CA", { timeZone: home.timezone })
      .format(new Date())
      .slice(0, 7);
    await db.usageMonth.create({
      data: {
        businessId: home.id,
        month,
        conversations: 90,
        alert80SentAt: new Date(),
        alert100SentAt: null,
      },
    });

    const res = await call(app, operatorCookie, "PUT", `/v1/platform/businesses/${home.id}/quota`, {
      quota: 500,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ monthlyConversationQuota: 500, conversationsThisMonth: 90 });
    const usage = await db.usageMonth.findUniqueOrThrow({
      where: { businessId_month: { businessId: home.id, month } },
    });
    expect(usage.alert80SentAt).toBeNull();

    const cleared = await call(
      app,
      operatorCookie,
      "PUT",
      `/v1/platform/businesses/${home.id}/quota`,
      {
        quota: null,
      },
    );
    expect(cleared.json()).toMatchObject({ monthlyConversationQuota: null });
  });

  it("validates the quota and refuses everyone but the operator", async () => {
    const { app, home, operatorCookie, adminCookie } = await setup();
    const url = `/v1/platform/businesses/${home.id}/quota`;
    for (const quota of [0, -5, 2.5, "100", 2_000_000]) {
      expect((await call(app, operatorCookie, "PUT", url, { quota })).statusCode).toBe(400);
    }
    expect((await call(app, adminCookie, "PUT", url, { quota: 100 })).statusCode).toBe(403);
    expect(
      (
        await call(app, operatorCookie, "PUT", "/v1/platform/businesses/biz_nadie/quota", {
          quota: 1,
        })
      ).statusCode,
    ).toBe(404);
    const stored = await db.business.findUniqueOrThrow({ where: { id: home.id } });
    expect(stored.monthlyConversationQuota).toBeNull();
  });
});
