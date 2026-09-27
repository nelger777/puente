import { LoginRequestSchema, MeResponseSchema, type MeResponse } from "@puente/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Db } from "../db/client";
import type { IpRateLimiter } from "../engine/rate-limits";
import { authOf, requirePanelOrigin, requireSession } from "../lib/auth-guard";
import { ApiError, parseInput } from "../lib/errors";
import { login, logout, SESSION_COOKIE, SESSION_TTL_MS } from "../services/auth";

export interface AuthRoutesDeps {
  db: Db;
  sessionSecret: string;
  panelOrigin: string;
  limiter: IpRateLimiter;
  now: () => Date;
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function authRoutes(deps: AuthRoutesDeps) {
  return (app: FastifyInstance, _opts: unknown, done: () => void) => {
    const session = requireSession(deps.db, deps.sessionSecret, deps.now);
    app.addHook("preHandler", requirePanelOrigin(deps.panelOrigin));

    app.post("/auth/login", async (request, reply) => {
      if (!deps.limiter.hit(`login:${request.ip}`, deps.now().getTime())) {
        throw new ApiError(429, "rate_limited", "Demasiados intentos. Espera un minuto.");
      }
      const { email, password } = parseInput(LoginRequestSchema, request.body);
      const { token, user } = await login(deps.db, deps.sessionSecret, email, password, deps.now());
      setSessionCookie(reply, token);
      const business = await deps.db.business.findUniqueOrThrow({
        where: { id: user.businessId },
        select: { id: true, name: true },
      });
      const body: MeResponse = {
        user: { id: user.id, email: user.email, role: user.role },
        business,
      };
      return MeResponseSchema.parse(body);
    });

    app.post("/auth/logout", { preHandler: session }, async (request, reply) => {
      await logout(deps.db, deps.sessionSecret, authOf(request).sessionToken);
      void reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.code(204).send();
    });

    app.get("/auth/me", { preHandler: session }, (request) => {
      const auth = authOf(request);
      const body: MeResponse = {
        user: { id: auth.userId, email: auth.email, role: auth.role },
        business: { id: auth.businessId, name: auth.businessName },
      };
      return MeResponseSchema.parse(body);
    });

    done();
  };
}
