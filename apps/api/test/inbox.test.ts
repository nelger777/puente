/** Inbox: search, assignee and internal notes (docs/DECISIONS.md § Bandeja). */
import {
  ApiErrorResponseSchema,
  ChatResponseSchema,
  HandoffDetailSchema,
  HandoffListResponseSchema,
  TeamResponseSchema,
} from "@puente/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBusiness,
  createUser,
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
  method: "GET" | "PATCH" | "POST",
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
  const { app } = makeApp(db);
  const openCase = async (contact?: { name: string; phone: string }) => {
    const chat = ChatResponseSchema.parse(
      (
        await postChat(app, { key: business.publicKey, message: "Quiero hablar con una persona" })
      ).json(),
    );
    const code = chat.handoff?.code ?? "";
    if (contact) {
      await db.handoff.update({
        where: { code },
        data: { contactName: contact.name, contactPhone: contact.phone },
      });
    }
    return code;
  };
  return {
    app,
    business,
    admin,
    agent,
    openCase,
    adminCookie: await loginAs(app, admin.email),
    agentCookie: await loginAs(app, agent.email),
  };
}

const codes = async (app: App, cookie: string, query: string) =>
  HandoffListResponseSchema.parse(
    (await call(app, cookie, "GET", `/v1/admin/handoffs${query}`)).json(),
  ).items.map((h) => h.code);

describe("search", () => {
  it("finds a case by code, phone digits in any format, or contact name", async () => {
    const { app, openCase, agentCookie } = await setup();
    const ana = await openCase({ name: "Ana Benítez", phone: "0981 123-456" });
    const luis = await openCase({ name: "Luis Gómez", phone: "+595 971 555 000" });
    await openCase();

    expect(await codes(app, agentCookie, `?q=${ana.toLowerCase()}`)).toEqual([ana]);
    expect(await codes(app, agentCookie, "?q=0981123456")).toEqual([ana]);
    expect(await codes(app, agentCookie, `?q=${encodeURIComponent("971 555")}`)).toEqual([luis]);
    expect(await codes(app, agentCookie, "?q=gomez")).toEqual([]); // accents are not folded
    expect(await codes(app, agentCookie, `?q=${encodeURIComponent("Gómez")}`)).toEqual([luis]);
    expect(await codes(app, agentCookie, "?q=benitez")).toEqual([]);
    expect(await codes(app, agentCookie, "?q=nadie")).toEqual([]);
  });
});

describe("assignee", () => {
  it("lets any user assign a case to a teammate, filter by it and unassign", async () => {
    const { app, openCase, admin, agent, agentCookie, adminCookie } = await setup();
    const mine = await openCase();
    const theirs = await openCase();
    await openCase();

    const res = await call(app, agentCookie, "PATCH", `/v1/admin/handoffs/${mine}`, {
      assigneeId: agent.id,
    });
    expect(res.statusCode).toBe(200);
    const detail = HandoffDetailSchema.parse(res.json());
    expect(detail.assignee).toEqual({ id: agent.id, email: agent.email });
    expect(detail.events.at(-1)).toMatchObject({ type: "assigned", actor: agent.id });

    await call(app, agentCookie, "PATCH", `/v1/admin/handoffs/${theirs}`, { assigneeId: admin.id });
    expect(await codes(app, agentCookie, "?assignee=me")).toEqual([mine]);
    expect(await codes(app, adminCookie, "?assignee=me")).toEqual([theirs]);
    expect(await codes(app, agentCookie, "?assignee=none")).toHaveLength(1);
    expect(await codes(app, agentCookie, `?assignee=${admin.id}`)).toEqual([theirs]);
    expect(await codes(app, adminCookie, `?assignee=${agent.id}`)).toEqual([mine]);
    expect(
      (await call(app, agentCookie, "GET", "/v1/admin/handoffs?assignee=alguien")).statusCode,
    ).toBe(400);

    const cleared = HandoffDetailSchema.parse(
      (
        await call(app, adminCookie, "PATCH", `/v1/admin/handoffs/${mine}`, { assigneeId: null })
      ).json(),
    );
    expect(cleared.assignee).toBeNull();
    expect(cleared.events.at(-1)?.type).toBe("unassigned");
  });

  it("changes status and assignee in one call", async () => {
    const { app, openCase, agent, agentCookie } = await setup();
    const code = await openCase();
    const detail = HandoffDetailSchema.parse(
      (
        await call(app, agentCookie, "PATCH", `/v1/admin/handoffs/${code}`, {
          assigneeId: agent.id,
          status: "RESOLVED",
        })
      ).json(),
    );
    expect(detail).toMatchObject({ status: "RESOLVED", assignee: { id: agent.id } });
  });

  it("refuses users outside the team (other business, disabled); counts the operator at home", async () => {
    const { app, business, openCase, adminCookie } = await setup();
    const code = await openCase();
    const other = await createBusiness(db, { name: "Otro", slug: "otro" });
    const outsider = await createUser(db, other.id, "ADMIN");
    const disabled = await createUser(db, business.id, "AGENT");
    await db.user.update({ where: { id: disabled.id }, data: { active: false } });
    // The operator's account lives in this business: they work its cases like anyone else.
    const operator = await createUser(db, business.id, "ADMIN");
    await db.user.update({ where: { id: operator.id }, data: { isPlatformAdmin: true } });

    for (const user of [outsider, disabled]) {
      const res = await call(app, adminCookie, "PATCH", `/v1/admin/handoffs/${code}`, {
        assigneeId: user.id,
      });
      expect(res.statusCode).toBe(400);
    }
    const team = TeamResponseSchema.parse(
      (await call(app, adminCookie, "GET", "/v1/admin/team")).json(),
    );
    expect(team.members.map((m) => m.id)).toContain(operator.id);
    expect(team.members).toHaveLength(3);
    const ok = await call(app, adminCookie, "PATCH", `/v1/admin/handoffs/${code}`, {
      assigneeId: operator.id,
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe("notes", () => {
  it("adds internal notes with their author and counts them in the list", async () => {
    const { app, openCase, agent, agentCookie } = await setup();
    const code = await openCase();
    const res = await call(app, agentCookie, "POST", `/v1/admin/handoffs/${code}/notes`, {
      body: "  Llamé y no atendió; reintentar a la tarde.  ",
    });
    expect(res.statusCode).toBe(201);
    const detail = HandoffDetailSchema.parse(res.json());
    expect(detail.notes).toEqual([
      expect.objectContaining({
        author: agent.email,
        body: "Llamé y no atendió; reintentar a la tarde.",
      }),
    ]);
    const list = HandoffListResponseSchema.parse(
      (await call(app, agentCookie, "GET", "/v1/admin/handoffs")).json(),
    );
    expect(list.items[0]?.noteCount).toBe(1);
  });

  it("rejects an empty or too long note", async () => {
    const { app, openCase, agentCookie } = await setup();
    const code = await openCase();
    for (const body of ["   ", "x".repeat(1001)]) {
      const res = await call(app, agentCookie, "POST", `/v1/admin/handoffs/${code}/notes`, {
        body,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("keeps other businesses out", async () => {
    const { app, openCase } = await setup();
    const code = await openCase();
    const other = await createBusiness(db, { name: "Otro", slug: "otro" });
    const outsider = await loginAs(app, (await createUser(db, other.id, "ADMIN")).email);
    const res = await call(app, outsider, "POST", `/v1/admin/handoffs/${code}/notes`, {
      body: "Hola",
    });
    expect(res.statusCode).toBe(404);
    expect(ApiErrorResponseSchema.parse(res.json()).error.code).toBe("handoff_not_found");
    expect(await codes(app, outsider, `?q=${code}`)).toEqual([]);
    expect(await db.handoffNote.count()).toBe(0);
  });
});
