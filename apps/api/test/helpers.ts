import { buildApp, type AppDeps, type AppEnv } from "../src/app";
import { createDb, type Db } from "../src/db/client";
import type { LlmReply, LlmRequest, LlmTransport } from "../src/engine/llm";
import type { Business, Prisma } from "../src/generated/prisma/client";
import { newId, newPublicKey } from "../src/lib/ids";
import { hashPassword } from "../src/lib/password";
import type { MailMessage, Mailer } from "../src/services/mailer";

export function testDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set for tests");
  return createDb(url);
}

/** Wipes every table (all of them cascade from Business). Test database only. */
export async function resetDb(db: Db): Promise<void> {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Business" CASCADE');
}

export const ORIGIN = "https://opticamirador.com";

export async function createBusiness(
  db: Db,
  overrides: Partial<Prisma.BusinessCreateInput> = {},
): Promise<Business> {
  const id = newId("biz");
  return db.business.create({
    data: {
      id,
      slug: `test-${id}`,
      name: "Óptica Mirador",
      kind: "óptica",
      botName: "Luz",
      whatsappNumber: "595981000000",
      notifyEmail: "equipo@opticamirador.com",
      hours: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" },
      offHoursMessage: "Te responderán apenas abran.",
      greeting: "¡Hola! Soy Luz.",
      suggestions: ["¿Cuál es el horario?"],
      sensitiveTopics: ["reclamo", "receta médica"],
      allowedDomains: ["opticamirador.com"],
      publicKey: newPublicKey(),
      knowledge: {
        create: [
          {
            id: newId("kb"),
            question: "¿Cuál es el horario?",
            answer: "Lunes a sábado de 08:00 a 18:00.",
            position: 0,
          },
        ],
      },
      ...overrides,
    },
  });
}

type LlmStep =
  | { json: Record<string, unknown> }
  | { text: string; complete?: boolean }
  | { error: Error }
  | "hang";

/** Scripted stand-in for an AI provider: one step per call, records every request. */
export class FakeLlm implements LlmTransport {
  readonly calls: LlmRequest[] = [];

  constructor(private readonly steps: LlmStep[] = []) {}

  push(...steps: LlmStep[]): this {
    this.steps.push(...steps);
    return this;
  }

  send(request: LlmRequest, options: { signal: AbortSignal }): Promise<LlmReply> {
    this.calls.push(request);
    const step = this.steps.shift();
    if (!step) return Promise.reject(new Error("FakeLlm: no scripted response left"));
    if (step === "hang") {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    if ("error" in step) return Promise.reject(step.error);
    const text = "json" in step ? JSON.stringify(step.json) : step.text;
    const complete = "complete" in step ? (step.complete ?? true) : true;
    return Promise.resolve(llmReply(text, complete));
  }
}

export function llmReply(text: string, complete = true): LlmReply {
  return { text, complete, inputTokens: 120, outputTokens: 30 };
}

export function answer(reply: string, quickReplies: string[] = []) {
  return {
    json: {
      reply,
      handoff: false,
      reason: null,
      summary: "",
      wa_message: "",
      quick_replies: quickReplies,
    },
  };
}

export function handoffAnswer(reason: string, extra: Record<string, unknown> = {}) {
  return {
    json: {
      reply: "Te conecto con una persona del equipo.",
      handoff: true,
      reason,
      summary: "El cliente necesita ayuda.",
      wa_message: "Hola, quiero saber el precio de unos lentes progresivos.",
      quick_replies: [],
      ...extra,
    },
  };
}

export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

export const TEST_ENV: AppEnv = {
  NODE_ENV: "test",
  LLM_MODEL: "claude-haiku-4-5-20251001",
  LLM_TIMEOUT_MS: 300,
  PANEL_URL: "https://panel.puente.test",
  PUBLIC_API_URL: "https://api.puente.test",
  WIDGET_CDN_URL: "https://cdn.puente.test",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  LLM_PRICE_INPUT_PER_MTOK: 1,
  LLM_PRICE_OUTPUT_PER_MTOK: 5,
  GEMINI_MODEL: "gemini-3.8-flash",
  SECRETS_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

export function makeApp(db: Db, deps: Partial<AppDeps> = {}) {
  const llm = (deps.llm as FakeLlm | undefined) ?? new FakeLlm();
  const mailer = (deps.mailer as FakeMailer | undefined) ?? new FakeMailer();
  const app = buildApp({ db, env: TEST_ENV, ...deps, llm, mailer });
  return { app, llm, mailer };
}

export interface ChatBody {
  key: string;
  message: string;
  conversationId?: string | null;
  conversationToken?: string | null;
  visitorId?: string;
}

export function postChat(
  app: ReturnType<typeof buildApp>,
  body: ChatBody,
  origin: string = ORIGIN,
) {
  return app.inject({
    method: "POST",
    url: "/v1/chat",
    headers: { origin },
    payload: { visitorId: "v_test", conversationId: null, conversationToken: null, ...body },
  });
}

export const PANEL_ORIGIN = "https://panel.puente.test";
export const PASSWORD = "clave-segura-123";

let cachedHash: Promise<string> | undefined;

export async function createUser(
  db: Db,
  businessId: string,
  role: "ADMIN" | "AGENT" = "ADMIN",
  email = `${role.toLowerCase()}-${newId("usr")}@test.com`,
) {
  cachedHash ??= hashPassword(PASSWORD);
  return db.user.create({
    data: { id: newId("usr"), businessId, email, role, passwordHash: await cachedHash },
  });
}

/** Logs in through the real endpoint and returns the Cookie header to reuse. */
export async function loginAs(app: ReturnType<typeof buildApp>, email: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin: PANEL_ORIGIN },
    payload: { email, password: PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === "puente_session");
  if (!cookie) throw new Error("no session cookie");
  return `puente_session=${cookie.value}`;
}
