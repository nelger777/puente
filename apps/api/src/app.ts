import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import type { Db } from "./db/client";
import type { LlmTransport } from "./engine/llm";
import type { EngineDeps } from "./engine/pipeline";
import { IpRateLimiter } from "./engine/rate-limits";
import { BackgroundTasks } from "./lib/background";
import type { Env } from "./lib/env";
import { ApiError } from "./lib/errors";
import { SecretBox } from "./lib/secrets";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import type { Mailer } from "./services/mailer";
import { createLlmRouter } from "./services/llm-router";
import { Notifier } from "./services/notifications";
import { UsageMeter } from "./services/usage";

declare module "fastify" {
  interface FastifyInstance {
    background: BackgroundTasks;
  }
}

export type AppEnv = Pick<
  Env,
  | "NODE_ENV"
  | "LLM_MODEL"
  | "LLM_TIMEOUT_MS"
  | "PANEL_URL"
  | "PUBLIC_API_URL"
  | "WIDGET_CDN_URL"
  | "SESSION_SECRET"
  | "LLM_PRICE_INPUT_PER_MTOK"
  | "LLM_PRICE_OUTPUT_PER_MTOK"
  | "GEMINI_MODEL"
  | "SECRETS_KEY"
  | "ALERT_EMAIL"
>;

export interface AppDeps {
  db: Db;
  env: AppEnv;
  llm: LlmTransport;
  mailer: Mailer;
  now?: () => Date;
  limiter?: IpRateLimiter;
  /** Tests replace the per-business transports (never a real provider in CI). */
  makeClaude?: (apiKey: string) => LlmTransport;
  makeGemini?: (apiKey: string) => LlmTransport;
}

export function buildApp(deps: AppDeps, options: FastifyServerOptions = {}) {
  const app = Fastify({
    bodyLimit: 16 * 1024,
    // Our own ids only: a client-supplied request id could inject noise into the logs.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    ...options,
  });

  const background = new BackgroundTasks(app.log);
  app.decorate("background", background);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    // Panel data and sessions must never sit in shared or browser caches.
    if (request.url.startsWith("/v1/admin") || request.url.startsWith("/v1/auth")) {
      reply.header("cache-control", "no-store");
    }
  });
  app.addHook("onClose", async () => {
    await background.drain();
  });

  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send(error.toBody());
    }
    const status = error.statusCode ?? 500;
    if (status < 500) {
      return reply
        .code(status)
        .send({ error: { code: "invalid_request", message: "Invalid request" } });
    }
    // Only the error kind and its stack frames: messages (e.g. Prisma validation errors) can
    // embed customer data, which must never reach the logs.
    request.log.error(
      {
        errName: error.name,
        errCode: (error as { code?: unknown }).code,
        stack: error.stack?.split("\n").slice(1, 8).join("\n"),
      },
      "unhandled error",
    );
    return reply
      .code(500)
      .send({ error: { code: "internal_error", message: "Internal server error" } });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: "not_found", message: "Route not found" } }),
  );

  app.get("/health", () => ({ status: "ok" }));
  // Readiness for the container healthcheck: the process is up and the database answers.
  app.get("/ready", async (_request, reply) => {
    try {
      await deps.db.$queryRaw`SELECT 1`;
      return { status: "ready" };
    } catch {
      return reply
        .code(503)
        .send({ error: { code: "internal_error", message: "Database unavailable" } });
    }
  });

  const { env } = deps;
  const secrets = env.SECRETS_KEY ? new SecretBox(env.SECRETS_KEY) : null;
  const llmFor = createLlmRouter({
    defaultTransport: deps.llm,
    claudeModel: env.LLM_MODEL,
    geminiModel: env.GEMINI_MODEL,
    secrets,
    ...(deps.makeClaude ? { makeClaude: deps.makeClaude } : {}),
    ...(deps.makeGemini ? { makeGemini: deps.makeGemini } : {}),
  });
  const engine: EngineDeps = {
    db: deps.db,
    llmFor,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    limiter: deps.limiter ?? new IpRateLimiter(30, 60_000),
    notifier: new Notifier(deps.db, deps.mailer, background, env.PANEL_URL),
    usage: new UsageMeter(deps.db, deps.mailer, background, env.ALERT_EMAIL, env.PANEL_URL),
    internalOrigins: [env.PANEL_URL, env.PUBLIC_API_URL, env.WIDGET_CDN_URL].map(
      (u) => new URL(u).origin,
    ),
    now: deps.now ?? (() => new Date()),
  };
  const panelOrigin = new URL(env.PANEL_URL).origin;

  void app.register(cookie);
  void app.register(
    publicRoutes({
      ...engine,
      allowLocalhost: env.NODE_ENV === "development",
      publicApiUrl: env.PUBLIC_API_URL,
    }),
    {
      prefix: "/v1",
    },
  );
  void app.register(
    authRoutes({
      db: deps.db,
      sessionSecret: env.SESSION_SECRET,
      panelOrigin,
      limiter: engine.limiter,
      now: engine.now,
    }),
    { prefix: "/v1" },
  );
  void app.register(
    adminRoutes({
      ...engine,
      sessionSecret: env.SESSION_SECRET,
      panelOrigin,
      widgetBaseUrl: env.WIDGET_CDN_URL,
      publicApiUrl: env.PUBLIC_API_URL,
      secrets,
      prices: {
        inputPerMTok: env.LLM_PRICE_INPUT_PER_MTOK,
        outputPerMTok: env.LLM_PRICE_OUTPUT_PER_MTOK,
      },
    }),
    { prefix: "/v1/admin" },
  );

  return app;
}
