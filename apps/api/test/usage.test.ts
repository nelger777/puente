import { ChatResponseSchema, MetricsResponseSchema } from "@puente/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { localMonth } from "../src/lib/time";
import { runRetention } from "../src/services/retention";
import { formatMonth, recordConversation } from "../src/services/usage";
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

async function usageOf(businessId: string) {
  return db.usageMonth.findMany({ where: { businessId }, orderBy: { month: "asc" } });
}

describe("monthly conversation count", () => {
  it("counts a conversation once, on its first customer message", async () => {
    const business = await createBusiness(db);
    const llm = new FakeLlm([answer("Abrimos a las 8."), answer("Sí."), answer("De nada.")]);
    const { app } = makeApp(db, { llm });

    const first = ChatResponseSchema.parse(
      (await postChat(app, { key: business.publicKey, message: "¿Horario?" })).json(),
    );
    for (const message of ["¿Los sábados también?", "Gracias"]) {
      await postChat(app, {
        key: business.publicKey,
        message,
        conversationId: first.conversationId,
        conversationToken: first.conversationToken,
      });
    }
    await app.background.drain();

    const rows = await usageOf(business.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      month: localMonth(new Date(), business.timezone),
      conversations: 1,
    });
  });

  it("does not count the panel's preview conversations", async () => {
    const business = await createBusiness(db);
    const admin = await createUser(db, business.id);
    const { app } = makeApp(db);
    const cookie = await loginAs(app, admin.email);

    const res = await call(app, cookie, "POST", "/v1/admin/preview-chat", { message: "persona" });
    expect(res.statusCode).toBe(200);
    await app.background.drain();

    expect(await usageOf(business.id)).toHaveLength(0);
  });

  it("assigns the month in the business timezone", async () => {
    const business = await createBusiness(db, { timezone: "America/Asuncion" }); // UTC-3
    // 2026-10-31 23:30 in Asunción, already November in UTC.
    await recordConversation(db, business, new Date("2026-11-01T02:30:00Z"));
    await recordConversation(db, business, new Date("2026-11-01T03:30:00Z"));

    const rows = await usageOf(business.id);
    expect(rows.map((r) => [r.month, r.conversations])).toEqual([
      ["2026-10", 1],
      ["2026-11", 1],
    ]);
  });

  it("keeps the monthly count when retention deletes the conversations", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db, { llm: new FakeLlm([answer("Abrimos a las 8.")]) });
    await postChat(app, { key: business.publicKey, message: "¿Horario?" });
    await app.background.drain();

    const result = await runRetention(db, 1, new Date(Date.now() + 3 * 86_400_000));
    expect(result.conversations).toBe(1);
    expect((await usageOf(business.id))[0]?.conversations).toBe(1);
  });
});

describe("plan alerts", () => {
  const OCT = new Date("2026-10-15T15:00:00Z");
  const NOV = new Date("2026-11-15T15:00:00Z");

  it("warns once at 80 % and once at 100 %, and again the next month", async () => {
    const business = await createBusiness(db, { monthlyConversationQuota: 5 });
    const alerts = [];
    for (let i = 0; i < 7; i++) alerts.push((await recordConversation(db, business, OCT)).alert);
    expect(alerts).toEqual([null, null, null, "warning", "reached", null, null]);

    const next = [];
    for (let i = 0; i < 4; i++) next.push((await recordConversation(db, business, NOV)).alert);
    expect(next).toEqual([null, null, null, "warning"]);
  });

  it("never sends the warning after the quota was already reached", async () => {
    const business = await createBusiness(db, { monthlyConversationQuota: 1 });
    expect((await recordConversation(db, business, OCT)).alert).toBe("reached");
    const raised = { ...business, monthlyConversationQuota: 10 };
    for (let i = 0; i < 8; i++) {
      expect((await recordConversation(db, raised, OCT)).alert).toBeNull();
    }
  });

  it("sends no alerts without a quota", async () => {
    const business = await createBusiness(db);
    for (let i = 0; i < 3; i++) {
      expect((await recordConversation(db, business, OCT)).alert).toBeNull();
    }
    expect((await usageOf(business.id))[0]?.conversations).toBe(3);
  });

  it("e-mails the team and the operator, and the assistant keeps answering over the quota", async () => {
    const business = await createBusiness(db, { monthlyConversationQuota: 1 });
    const llm = new FakeLlm([answer("Abrimos a las 8."), answer("Abrimos a las 8.")]);
    const { app, mailer } = makeApp(db, { llm });

    await postChat(app, { key: business.publicKey, message: "¿Horario?" });
    await app.background.drain();
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([
      "equipo@opticamirador.com",
      "ops@puente.test",
    ]);
    const [mail] = mailer.sent;
    expect(mail?.subject).toContain("se alcanzó el plan de conversaciones");
    expect(mail?.text).toContain("sigue respondiendo");

    const over = await postChat(app, {
      key: business.publicKey,
      message: "¿Horario?",
      visitorId: "v_other",
    });
    await app.background.drain();
    expect(over.statusCode).toBe(200);
    expect(ChatResponseSchema.parse(over.json())).toMatchObject({
      reply: "Abrimos a las 8.",
      handoff: null,
    });
    expect(mailer.sent).toHaveLength(2);
    expect((await usageOf(business.id))[0]?.conversations).toBe(2);
  });
});

describe("usage in the panel", () => {
  it("returns the current month's usage of the logged-in business only", async () => {
    const business = await createBusiness(db, { monthlyConversationQuota: 4000 });
    const other = await createBusiness(db);
    const admin = await createUser(db, business.id);
    const now = new Date();
    await recordConversation(db, business, now);
    await recordConversation(db, business, now);
    for (let i = 0; i < 5; i++) await recordConversation(db, other, now);

    const { app } = makeApp(db);
    const cookie = await loginAs(app, admin.email);
    const metrics = MetricsResponseSchema.parse(
      (await call(app, cookie, "GET", "/v1/admin/metrics")).json(),
    );
    expect(metrics.usage).toEqual({
      month: localMonth(now, business.timezone),
      conversations: 2,
      quota: 4000,
    });
  });

  it("does not let the panel change the quota", async () => {
    const business = await createBusiness(db, { monthlyConversationQuota: 4000 });
    const admin = await createUser(db, business.id);
    const { app } = makeApp(db);
    const cookie = await loginAs(app, admin.email);

    const current = (await call(app, cookie, "GET", "/v1/admin/business")).json<
      Record<string, unknown>
    >();
    await call(app, cookie, "PUT", "/v1/admin/business", {
      ...current,
      monthlyConversationQuota: 999_999,
    });

    const stored = await db.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(stored.monthlyConversationQuota).toBe(4000);
  });
});

describe("formatMonth", () => {
  it("names the month in Spanish", () => {
    expect(formatMonth("2026-10")).toBe("octubre de 2026");
  });
});
