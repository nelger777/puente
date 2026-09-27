import { Writable } from "node:stream";
import { ChatResponseSchema, MetricsResponseSchema } from "@puente/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { parseEnv } from "../src/lib/env";
import { newId } from "../src/lib/ids";
import { hashToken } from "../src/lib/tokens";
import {
  ALERT_MIN_ATTEMPTS,
  LlmHealthMonitor,
  measureLlmHealth,
  shouldAlert,
} from "../src/services/llm-health";
import { runRetention } from "../src/services/retention";
import {
  answer,
  createBusiness,
  createUser,
  FakeLlm,
  FakeMailer,
  loginAs,
  makeApp,
  PANEL_ORIGIN,
  postChat,
  resetDb,
  TEST_ENV,
  testDb,
} from "./helpers";

const db = testDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const DAY = 86_400_000;

async function conversationWithCase(businessId: string, lastMessageAt: Date) {
  const conversation = await db.conversation.create({
    data: {
      id: newId("conv"),
      businessId,
      tokenHash: hashToken("t".repeat(43)),
      visitorId: "v",
      originDomain: "opticamirador.com",
      lastMessageAt,
      startedAt: lastMessageAt,
      messages: { create: [{ id: newId("msg"), role: "USER", content: "mi teléfono es 0981" }] },
    },
  });
  await db.handoff.create({
    data: {
      id: newId("hof"),
      code: `DER-${Math.floor(100000 + Math.random() * 899999)}`,
      businessId,
      conversationId: conversation.id,
      reason: "EXPLICIT_REQUEST",
      summary: "s",
      waMessage: "w",
      openedInHours: true,
      contactPhone: "0981 000 000",
      events: { create: [{ id: newId("hev"), type: "created", actor: "system" }] },
    },
  });
  return conversation;
}

describe("retention", () => {
  it("deletes conversations idle for more than RETENTION_DAYS with all their data", async () => {
    const business = await createBusiness(db);
    const now = new Date("2026-09-30T12:00:00Z");
    const old = await conversationWithCase(business.id, new Date(now.getTime() - 91 * DAY));
    const recent = await conversationWithCase(business.id, new Date(now.getTime() - 89 * DAY));

    const result = await runRetention(db, 90, now);

    expect(result.conversations).toBe(1);
    expect(await db.conversation.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.conversation.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await db.message.count()).toBe(1);
    expect(await db.handoff.count()).toBe(1); // the pending case of the old one is gone too
    expect(await db.handoffEvent.count()).toBe(1);
    expect(await db.business.count()).toBe(1);
  });

  it("removes expired panel sessions", async () => {
    const business = await createBusiness(db);
    const user = await createUser(db, business.id);
    const now = new Date("2026-09-30T12:00:00Z");
    for (const expiresAt of [new Date(now.getTime() - 1000), new Date(now.getTime() + DAY)]) {
      await db.session.create({
        data: { id: newId("ses"), tokenHash: newId("ses"), userId: user.id, expiresAt },
      });
    }
    expect((await runRetention(db, 90, now)).sessions).toBe(1);
    expect(await db.session.count()).toBe(1);
  });
});

describe("LLM failure alert", () => {
  async function replies(ok: number, failed: number, at = new Date()) {
    const business = await createBusiness(db);
    const conversation = await conversationWithCase(business.id, at);
    const data = [
      ...Array.from({ length: ok }, () => ({ engine: "llm", llmError: null })),
      ...Array.from({ length: failed }, () => ({ engine: "rules", llmError: "timeout" })),
    ].map((m) => ({
      id: newId("msg"),
      conversationId: conversation.id,
      role: "ASSISTANT" as const,
      content: "x",
      createdAt: at,
      ...m,
    }));
    await db.message.createMany({ data });
  }

  it("needs more than 5% failures over at least 20 attempts", () => {
    expect(shouldAlert({ attempts: ALERT_MIN_ATTEMPTS - 1, failures: 10, rate: 10 / 19 })).toBe(
      false,
    );
    expect(shouldAlert({ attempts: 20, failures: 1, rate: 0.05 })).toBe(false);
    expect(shouldAlert({ attempts: 20, failures: 2, rate: 0.1 })).toBe(true);
  });

  it("measures the last hour only", async () => {
    await replies(18, 2);
    await replies(0, 30, new Date(Date.now() - 2 * 60 * 60 * 1000));
    expect(await measureLlmHealth(db, new Date())).toEqual({
      attempts: 20,
      failures: 2,
      rate: 0.1,
    });
  });

  it("e-mails the operator once per hour", async () => {
    await replies(18, 2);
    const mailer = new FakeMailer();
    const app = buildApp({ db, env: TEST_ENV, llm: new FakeLlm(), mailer });
    const monitor = new LlmHealthMonitor(db, mailer, "ops@puente.test", app.log);
    const now = new Date();

    expect((await monitor.check(now)).alerted).toBe(true);
    expect((await monitor.check(new Date(now.getTime() + 5 * 60 * 1000))).alerted).toBe(false);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: "ops@puente.test" });
    expect(mailer.sent[0]?.subject).toContain("10.0%");
  });

  it("records the failure kind on the reply", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db, { llm: new FakeLlm(["hang", { text: "no json" }]) });
    await postChat(app, { key: business.publicKey, message: "¿Horario?" });
    await postChat(app, { key: business.publicKey, message: "¿Horario?" });
    const errors = (await db.message.findMany({ where: { role: "ASSISTANT" } })).map(
      (m) => m.llmError,
    );
    expect(errors.sort()).toEqual(["invalid_output", "timeout"]);
  });
});

describe("token metrics", () => {
  it("estimates cost per period and per conversation, and reports LLM failures", async () => {
    const business = await createBusiness(db);
    const admin = await createUser(db, business.id);
    const { app } = makeApp(db, { llm: new FakeLlm([answer("A las 8."), "hang"]) });
    await postChat(app, { key: business.publicKey, message: "¿Horario?" });
    await postChat(app, { key: business.publicKey, message: "¿Horario?" });
    const cookie = await loginAs(app, admin.email);

    const metrics = MetricsResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/metrics",
          headers: { cookie, origin: PANEL_ORIGIN },
        })
      ).json(),
    );
    // 120 input × $1/M + 30 output × $5/M = $0.00027 over 2 conversations
    expect(metrics.tokens).toMatchObject({
      input: 120,
      output: 30,
      estimatedCostUsd: 0.0003,
      costPerConversationUsd: 0.0001,
    });
    expect(metrics.llm.failures).toEqual({ timeout: 1, api_error: 0, invalid_output: 0 });
    expect(metrics.llm.failureRate).toBe(0.5);
    expect(metrics.llm.avgLatencyMs).not.toBeNull();
  });
});

describe("security checklist", () => {
  it("accepts a large knowledge base despite the small global body limit", async () => {
    const business = await createBusiness(db);
    const admin = await createUser(db, business.id);
    const { app } = makeApp(db);
    const cookie = await loginAs(app, admin.email);
    const items = Array.from({ length: 200 }, (_, i) => ({
      question: `Pregunta ${i} ${"q".repeat(250)}`,
      answer: "r".repeat(2000),
    }));
    const res = await app.inject({
      method: "PUT",
      url: "/v1/admin/knowledge",
      headers: { cookie, origin: PANEL_ORIGIN },
      payload: { items },
    });
    expect(res.statusCode).toBe(200);
    expect(await db.knowledgeItem.count()).toBe(200);

    const chat = await postChat(app, { key: business.publicKey, message: "x".repeat(999) + "y" });
    expect(chat.statusCode).not.toBe(413);
  });

  it("sends protective headers and never caches panel responses", async () => {
    const { app } = makeApp(db);
    const res = await app.inject({ method: "GET", url: "/v1/auth/me" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("refuses to start in production with the example secret or without an API key", () => {
    const base = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      PUBLIC_API_URL: "https://api.example.com",
      WIDGET_CDN_URL: "https://cdn.example.com",
      PANEL_URL: "https://panel.example.com",
      ANTHROPIC_API_KEY: "sk-test",
    };
    expect(() =>
      parseEnv({ ...base, SESSION_SECRET: "change-me-to-a-long-random-string-32chars" }),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      parseEnv({ ...base, ANTHROPIC_API_KEY: "", SESSION_SECRET: "x".repeat(40) }),
    ).toThrow(/ANTHROPIC_API_KEY/);
    expect(
      parseEnv({ ...base, SESSION_SECRET: "x".repeat(40), TRUST_PROXY: "true" }).TRUST_PROXY,
    ).toBe(true);
  });

  it("logs unexpected errors without their message", async () => {
    let output = "";
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        output += chunk.toString();
        cb();
      },
    });
    const app = buildApp(
      { db, env: TEST_ENV, llm: new FakeLlm(), mailer: new FakeMailer() },
      { logger: { level: "info", stream } },
    );
    app.get("/boom", () => {
      throw new Error("cliente Ana 0981 555 666");
    });
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: "internal_error", message: "Internal server error" },
    });
    expect(output).toContain("unhandled error");
    expect(output).not.toContain("0981 555 666");
  });

  it("stores only hashes of conversation and session tokens", async () => {
    const business = await createBusiness(db);
    const admin = await createUser(db, business.id);
    const { app } = makeApp(db, { llm: new FakeLlm([answer("Hola.")]) });
    const chat = ChatResponseSchema.parse(
      (await postChat(app, { key: business.publicKey, message: "hola" })).json(),
    );
    const cookie = await loginAs(app, admin.email);
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: chat.conversationId },
    });
    const session = await db.session.findFirstOrThrow();
    expect(conversation.tokenHash).not.toContain(chat.conversationToken);
    expect(session.tokenHash).not.toContain(cookie.split("=")[1] ?? "");
    expect(chat.conversationToken.length).toBeGreaterThanOrEqual(43); // 32 random bytes
  });
});
