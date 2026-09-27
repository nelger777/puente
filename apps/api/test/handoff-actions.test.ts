import { Writable } from "node:stream";
import { ChatResponseSchema } from "@puente/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import {
  createBusiness,
  FakeLlm,
  FakeMailer,
  makeApp,
  ORIGIN,
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

async function openCase(app: ReturnType<typeof makeApp>["app"], key: string) {
  const res = await postChat(app, { key, message: "Quiero hablar con una persona" });
  const chat = ChatResponseSchema.parse(res.json());
  if (!chat.handoff) throw new Error("expected a handoff");
  return { code: chat.handoff.code, token: chat.conversationToken };
}

describe("POST /v1/handoffs/:code/contact", () => {
  it("stores the contact data, records the event and e-mails the team", async () => {
    const business = await createBusiness(db);
    const { app, mailer } = makeApp(db);
    const { code, token } = await openCase(app, business.publicKey);

    const res = await app.inject({
      method: "POST",
      url: `/v1/handoffs/${code}/contact`,
      headers: { origin: ORIGIN },
      payload: {
        key: business.publicKey,
        conversationToken: token,
        name: "Ana",
        phone: "+595 981 123 456",
        consent: true,
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);

    const handoff = await db.handoff.findUniqueOrThrow({
      where: { code },
      include: { events: true },
    });
    expect(handoff).toMatchObject({ contactName: "Ana", contactPhone: "+595 981 123 456" });
    expect(handoff.events.map((e) => e.type)).toContain("contact_requested");

    await app.background.drain();
    expect(mailer.sent.map((m) => m.subject)).toEqual([
      expect.stringContaining("Nueva derivación"),
      `Pedido de contacto ${code}`,
    ]);
  });

  it("requires consent and a phone", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db);
    const { code, token } = await openCase(app, business.publicKey);
    const send = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/v1/handoffs/${code}/contact`,
        headers: { origin: ORIGIN },
        payload: { key: business.publicKey, conversationToken: token, ...payload },
      });
    expect((await send({ phone: "0981123456" })).statusCode).toBe(400);
    expect((await send({ phone: "0981123456", consent: false })).statusCode).toBe(400);
    expect((await send({ phone: "abc", consent: true })).statusCode).toBe(400);
  });

  it("hides cases from the wrong token or another business", async () => {
    const a = await createBusiness(db);
    const b = await createBusiness(db);
    const { app } = makeApp(db);
    const { code, token } = await openCase(app, a.publicKey);
    const send = (key: string, conversationToken: string) =>
      app.inject({
        method: "POST",
        url: `/v1/handoffs/${code}/contact`,
        headers: { origin: ORIGIN },
        payload: { key, conversationToken, phone: "0981123456", consent: true },
      });

    const wrongToken = await send(a.publicKey, "y".repeat(43));
    expect(wrongToken.statusCode).toBe(404);
    expect(wrongToken.json()).toMatchObject({ error: { code: "handoff_not_found" } });
    expect((await send(b.publicKey, token)).statusCode).toBe(404);
  });
});

describe("POST /v1/handoffs/:code/events", () => {
  it("records whatsapp_opened", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db);
    const { code, token } = await openCase(app, business.publicKey);
    const res = await app.inject({
      method: "POST",
      url: `/v1/handoffs/${code}/events`,
      headers: { origin: ORIGIN },
      payload: { key: business.publicKey, conversationToken: token, type: "whatsapp_opened" },
    });
    expect(res.statusCode).toBe(204);
    const event = await db.handoffEvent.findFirstOrThrow({ where: { type: "whatsapp_opened" } });
    expect(event.actor).toBe("customer");
  });

  it("rejects other event types", async () => {
    const business = await createBusiness(db);
    const { app } = makeApp(db);
    const { code, token } = await openCase(app, business.publicKey);
    const res = await app.inject({
      method: "POST",
      url: `/v1/handoffs/${code}/events`,
      headers: { origin: ORIGIN },
      payload: { key: business.publicKey, conversationToken: token, type: "resolved" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("logging", () => {
  it("never writes message contents or phone numbers to the logs", async () => {
    const business = await createBusiness(db);
    let output = "";
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const app = buildApp(
      { db, env: TEST_ENV, llm: new FakeLlm(["hang"]), mailer: new FakeMailer() },
      { logger: { level: "trace", stream } },
    );

    const secretMessage = "mi-cedula-es-4455667";
    const chat = await postChat(app, { key: business.publicKey, message: secretMessage });
    const { conversationToken, handoff } = ChatResponseSchema.parse(chat.json());
    await app.inject({
      method: "POST",
      url: `/v1/handoffs/${handoff?.code}/contact`,
      headers: { origin: ORIGIN },
      payload: {
        key: business.publicKey,
        conversationToken,
        phone: "0981 777 888",
        consent: true,
      },
    });
    await app.close();

    expect(output).toContain("llm call failed");
    expect(output).not.toContain(secretMessage);
    expect(output).not.toContain("777 888");
    expect(output).not.toContain(conversationToken);
  });
});
