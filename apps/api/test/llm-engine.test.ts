import Anthropic from "@anthropic-ai/sdk";
import {
  BusinessResponseSchema,
  LlmTestResponseSchema,
  MetricsResponseSchema,
} from "@puente/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  fromAnthropicError,
  geminiTransport,
  LlmTransportError,
  type LlmRequest,
} from "../src/engine/llm";
import { SecretBox } from "../src/lib/secrets";
import { createLlmRouter } from "../src/services/llm-router";
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
  TEST_ENV,
  testDb,
} from "./helpers";

const KEY = "AIzaSyFAKE-gemini_key.1234567890abcd";

describe("SecretBox", () => {
  const box = new SecretBox(TEST_ENV.SECRETS_KEY);

  it("round-trips, with a fresh IV every time", () => {
    const a = box.seal(KEY);
    expect(a).not.toContain(KEY);
    expect(a).not.toBe(box.seal(KEY));
    expect(box.open(a)).toBe(KEY);
  });

  it("rejects tampering and another key", () => {
    const sealed = Buffer.from(box.seal(KEY), "base64");
    sealed.writeUInt8(sealed.readUInt8(sealed.length - 1) ^ 1, sealed.length - 1);
    expect(() => box.open(sealed.toString("base64"))).toThrow();
    const other = new SecretBox("f".repeat(64));
    expect(() => other.open(box.seal(KEY))).toThrow();
  });

  it("requires 64 hex characters", () => {
    expect(() => new SecretBox("abc")).toThrow();
  });
});

describe("fromAnthropicError", () => {
  it("retries network errors and 5xx only", () => {
    expect(fromAnthropicError(new Anthropic.APIConnectionError({ message: "x" })).retryable).toBe(
      true,
    );
    const e500 = new Anthropic.InternalServerError(500, undefined, "boom", new Headers());
    expect(fromAnthropicError(e500).retryable).toBe(true);
    const e400 = new Anthropic.BadRequestError(400, undefined, "bad", new Headers());
    expect(fromAnthropicError(e400).retryable).toBe(false);
    expect(fromAnthropicError(new Anthropic.APIConnectionTimeoutError()).timeout).toBe(true);
  });
});

describe("geminiTransport", () => {
  const request: LlmRequest = {
    model: "gemini-test",
    system: "sistema",
    messages: [{ role: "user", content: "Hola" }],
    maxTokens: 100,
    jsonSchema: { type: "object" },
  };
  const options = () => ({ timeout: 1000, signal: new AbortController().signal });

  function fakeFetch(responses: Response[]) {
    const bodies: Record<string, unknown>[] = [];
    const headers: Headers[] = [];
    const fn = ((_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string) as Record<string, unknown>);
      headers.push(new Headers(init.headers));
      const next = responses.shift();
      if (!next) return Promise.reject(new Error("no response left"));
      return Promise.resolve(next);
    }) as unknown as typeof fetch;
    return { fn, bodies, headers };
  }

  const completion = (content: string, finish = "stop") =>
    Response.json({
      choices: [{ message: { content }, finish_reason: finish }],
      usage: { prompt_tokens: 50, completion_tokens: 7 },
    });

  it("sends the schema, the system prompt and the key as a bearer token", async () => {
    const fetch = fakeFetch([completion('{"ok":1}')]);
    const reply = await geminiTransport(KEY, fetch.fn, "https://g.test").send(request, options());
    expect(reply).toEqual({ text: '{"ok":1}', complete: true, inputTokens: 50, outputTokens: 7 });
    expect(fetch.headers[0]?.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(fetch.bodies[0]).toMatchObject({
      model: "gemini-test",
      messages: [
        { role: "system", content: "sistema" },
        { role: "user", content: "Hola" },
      ],
      response_format: { type: "json_schema" },
    });
  });

  it("falls back to plain JSON mode when the schema is rejected", async () => {
    const fetch = fakeFetch([new Response("bad", { status: 400 }), completion("{}")]);
    await geminiTransport(KEY, fetch.fn, "https://g.test").send(request, options());
    expect(fetch.bodies[1]?.response_format).toEqual({ type: "json_object" });
  });

  it("marks cut replies incomplete and classifies errors", async () => {
    const cut = fakeFetch([completion("{", "length")]);
    const reply = await geminiTransport(KEY, cut.fn, "https://g.test").send(request, options());
    expect(reply.complete).toBe(false);

    const limited = fakeFetch([new Response("quota", { status: 429 })]);
    const err429 = await geminiTransport(KEY, limited.fn, "https://g.test")
      .send(request, options())
      .catch((e: unknown) => e);
    expect(err429).toBeInstanceOf(LlmTransportError);
    expect((err429 as LlmTransportError).retryable).toBe(false);

    const down = fakeFetch([new Response("down", { status: 503 })]);
    const err503 = await geminiTransport(KEY, down.fn, "https://g.test")
      .send(request, options())
      .catch((e: unknown) => e);
    expect((err503 as LlmTransportError).retryable).toBe(true);
  });
});

describe("createLlmRouter", () => {
  const box = new SecretBox(TEST_ENV.SECRETS_KEY);
  const server = new FakeLlm();
  const made: string[] = [];
  const router = createLlmRouter({
    defaultTransport: server,
    claudeModel: "claude-m",
    geminiModel: "gemini-m",
    secrets: box,
    makeGemini: (key) => {
      made.push(key);
      return new FakeLlm();
    },
  });

  it("uses the server key unless the business has its own", () => {
    expect(router({ id: "b1", llmProvider: "default", llmApiKeySealed: null }).transport).toBe(
      server,
    );
    expect(router({ id: "b1", llmProvider: "gemini", llmApiKeySealed: null }).provider).toBe(
      "default",
    );
    expect(router({ id: "b1", llmProvider: "gemini", llmApiKeySealed: "garbage" }).provider).toBe(
      "default",
    );
  });

  it("opens the business key once and switches when it changes", () => {
    const sealed = box.seal(KEY);
    const a = router({ id: "b2", llmProvider: "gemini", llmApiKeySealed: sealed });
    const b = router({ id: "b2", llmProvider: "gemini", llmApiKeySealed: sealed });
    expect(a).toMatchObject({ provider: "gemini", model: "gemini-m" });
    expect(a.transport).toBe(b.transport);
    router({ id: "b2", llmProvider: "gemini", llmApiKeySealed: box.seal("otra-clave-1234567890") });
    expect(made).toEqual([KEY, "otra-clave-1234567890"]);
  });
});

describe("panel: AI engine per business", () => {
  const db = testDb();

  beforeEach(async () => {
    await resetDb(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  function call(
    app: ReturnType<typeof makeApp>["app"],
    cookie: string,
    method: "GET" | "PUT" | "POST",
    url: string,
    payload?: Record<string, unknown>,
  ) {
    return app.inject({
      method,
      url,
      headers: { cookie, origin: PANEL_ORIGIN },
      ...(payload ? { payload } : {}),
    });
  }

  it("stores the key sealed, never returns it, and routes the chat to Gemini", async () => {
    const business = await createBusiness(db);
    const admin = await createUser(db, business.id);
    const gemini = new FakeLlm([answer("ok"), answer("Hola desde Gemini.")]);
    const keys: string[] = [];
    const { app, llm } = makeApp(db, {
      makeGemini: (key) => {
        keys.push(key);
        return gemini;
      },
    });
    const cookie = await loginAs(app, admin.email);

    const saved = await call(app, cookie, "PUT", "/v1/admin/business/llm", {
      provider: "gemini",
      apiKey: KEY,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain(KEY);
    expect(BusinessResponseSchema.parse(saved.json()).llm).toEqual({
      provider: "gemini",
      hasKey: true,
      keyLast4: "abcd",
    });
    const row = await db.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(row.llmApiKeySealed).not.toContain(KEY);

    const got = await call(app, cookie, "GET", "/v1/admin/business");
    expect(got.body).not.toContain(KEY);
    expect(got.body).not.toContain(row.llmApiKeySealed);

    const test = LlmTestResponseSchema.parse(
      (await call(app, cookie, "POST", "/v1/admin/business/llm/test")).json(),
    );
    expect(test.ok).toBe(true);

    const chat = (await postChat(app, { key: business.publicKey, message: "Hola" })).json<{
      reply: string;
    }>();
    expect(chat.reply).toBe("Hola desde Gemini.");
    expect(keys).toEqual([KEY]);
    expect(gemini.calls[1]?.model).toBe(TEST_ENV.GEMINI_MODEL);
    expect(llm.calls).toHaveLength(0); // the server key was not used

    const metrics = MetricsResponseSchema.parse(
      (await call(app, cookie, "GET", "/v1/admin/metrics")).json(),
    );
    expect(metrics.tokens.estimatedCostUsd).toBe(0);
  });

  it("keeps the saved key when only re-saving, requires one for a new provider, clears on default", async () => {
    const business = await createBusiness(db);
    const admin = await createUser(db, business.id);
    const { app } = makeApp(db, { makeGemini: () => new FakeLlm() });
    const cookie = await loginAs(app, admin.email);

    const noKey = await call(app, cookie, "PUT", "/v1/admin/business/llm", { provider: "gemini" });
    expect(noKey.statusCode).toBe(400);
    await call(app, cookie, "PUT", "/v1/admin/business/llm", { provider: "gemini", apiKey: KEY });
    const again = await call(app, cookie, "PUT", "/v1/admin/business/llm", { provider: "gemini" });
    expect(BusinessResponseSchema.parse(again.json()).llm.hasKey).toBe(true);
    const switched = await call(app, cookie, "PUT", "/v1/admin/business/llm", {
      provider: "claude",
    });
    expect(switched.statusCode).toBe(400);

    const cleared = await call(app, cookie, "PUT", "/v1/admin/business/llm", {
      provider: "default",
    });
    expect(BusinessResponseSchema.parse(cleared.json()).llm).toEqual({
      provider: "default",
      hasKey: false,
      keyLast4: null,
    });
    const row = await db.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(row.llmApiKeySealed).toBeNull();
  });

  it("is ADMIN only, rejects bad keys, and reports a failing key", async () => {
    const business = await createBusiness(db);
    const admin = await createUser(db, business.id);
    const agent = await createUser(db, business.id, "AGENT");
    const { app } = makeApp(db, {
      makeGemini: () => new FakeLlm([{ error: new LlmTransportError("http 403", false) }]),
    });

    const agentCookie = await loginAs(app, agent.email);
    const forbidden = await call(app, agentCookie, "PUT", "/v1/admin/business/llm", {
      provider: "gemini",
      apiKey: KEY,
    });
    expect(forbidden.statusCode).toBe(403);
    expect((await call(app, agentCookie, "POST", "/v1/admin/business/llm/test")).statusCode).toBe(
      403,
    );

    const cookie = await loginAs(app, admin.email);
    const bad = await call(app, cookie, "PUT", "/v1/admin/business/llm", {
      provider: "gemini",
      apiKey: "tiene espacios y es corta",
    });
    expect(bad.statusCode).toBe(400);

    await call(app, cookie, "PUT", "/v1/admin/business/llm", { provider: "gemini", apiKey: KEY });
    const test = LlmTestResponseSchema.parse(
      (await call(app, cookie, "POST", "/v1/admin/business/llm/test")).json(),
    );
    expect(test.ok).toBe(false);
    expect(test.message).toContain("clave");
  });

  it("refuses own keys when the server has no SECRETS_KEY", async () => {
    const business = await createBusiness(db);
    const admin = await createUser(db, business.id);
    const { buildApp } = await import("../src/app");
    const app = buildApp({
      db,
      env: { ...TEST_ENV, SECRETS_KEY: "" },
      llm: new FakeLlm(),
      mailer: makeApp(db).mailer,
    });
    const cookie = await loginAs(app, admin.email);
    const res = await call(app, cookie, "PUT", "/v1/admin/business/llm", {
      provider: "gemini",
      apiKey: KEY,
    });
    expect(res.statusCode).toBe(409);
  });
});
