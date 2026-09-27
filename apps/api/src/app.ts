import { randomUUID } from "node:crypto";
import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import type { Db } from "./db/client";
import type { LlmTransport } from "./engine/llm";
import { IpRateLimiter } from "./engine/rate-limits";
import { BackgroundTasks } from "./lib/background";
import type { Env } from "./lib/env";
import { ApiError } from "./lib/errors";
import { publicRoutes } from "./routes/public";
import type { Mailer } from "./services/mailer";
import { Notifier } from "./services/notifications";

declare module "fastify" {
  interface FastifyInstance {
    background: BackgroundTasks;
  }
}

export type AppEnv = Pick<
  Env,
  "NODE_ENV" | "LLM_MODEL" | "LLM_TIMEOUT_MS" | "PANEL_URL" | "PUBLIC_API_URL" | "WIDGET_CDN_URL"
>;

export interface AppDeps {
  db: Db;
  env: AppEnv;
  llm: LlmTransport;
  mailer: Mailer;
  now?: () => Date;
  limiter?: IpRateLimiter;
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
    request.log.error({ err: error }, "unhandled error");
    return reply
      .code(500)
      .send({ error: { code: "internal_error", message: "Internal server error" } });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: "not_found", message: "Route not found" } }),
  );

  app.get("/health", () => ({ status: "ok" }));

  const { env } = deps;
  const notifier = new Notifier(deps.db, deps.mailer, background, env.PANEL_URL);
  void app.register(
    publicRoutes({
      db: deps.db,
      llm: deps.llm,
      llmConfig: { model: env.LLM_MODEL, timeoutMs: env.LLM_TIMEOUT_MS },
      limiter: deps.limiter ?? new IpRateLimiter(30, 60_000),
      notifier,
      internalOrigins: [env.PANEL_URL, env.PUBLIC_API_URL, env.WIDGET_CDN_URL].map(
        (u) => new URL(u).origin,
      ),
      allowLocalhost: env.NODE_ENV === "development",
      now: deps.now ?? (() => new Date()),
    }),
    { prefix: "/v1" },
  );

  return app;
}
