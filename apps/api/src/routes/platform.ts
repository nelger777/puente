import {
  ActAsSchema,
  BusinessCreateResponseSchema,
  BusinessCreateSchema,
  BusinessIdParamsSchema,
  BusinessQuotaSchema,
  PlatformBusinessListSchema,
  PlatformBusinessSchema,
} from "@puente/shared";
import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client";
import {
  authOf,
  loadAuth,
  requirePanelOrigin,
  requirePlatformAdmin,
  requireSession,
} from "../lib/auth-guard";
import { ApiError, parseInput } from "../lib/errors";
import type { LlmPrices } from "../services/admin";
import { actAs, createBusiness, listBusinesses, setBusinessQuota } from "../services/platform";
import { meResponse } from "./auth";

export interface PlatformRoutesDeps {
  db: Db;
  sessionSecret: string;
  panelOrigin: string;
  now: () => Date;
  prices: LlmPrices;
}

/** Platform operator API (docs/DECISIONS.md § Empresas). Nobody else gets past the guard. */
export function platformRoutes(deps: PlatformRoutesDeps) {
  return (app: FastifyInstance, _opts: unknown, done: () => void) => {
    const { db } = deps;
    app.addHook("preHandler", requirePanelOrigin(deps.panelOrigin));
    app.addHook("preHandler", requireSession(db, deps.sessionSecret, deps.now));
    app.addHook("preHandler", requirePlatformAdmin);

    app.get("/businesses", async () =>
      PlatformBusinessListSchema.parse({
        businesses: await listBusinesses(db, deps.now(), deps.prices),
      }),
    );

    app.post("/businesses", async (request, reply) => {
      const input = parseInput(BusinessCreateSchema, request.body);
      const created = await createBusiness(db, input, deps.now(), deps.prices);
      return reply.code(201).send(BusinessCreateResponseSchema.parse(created));
    });

    // Replaces the operator command set-quota (still available for scripts).
    app.put("/businesses/:id/quota", async (request) => {
      const { id } = parseInput(BusinessIdParamsSchema, request.params);
      const { quota } = parseInput(BusinessQuotaSchema, request.body);
      return PlatformBusinessSchema.parse(
        await setBusinessQuota(db, id, quota, deps.now(), deps.prices),
      );
    });

    app.post("/act-as", async (request) => {
      const { businessId } = parseInput(ActAsSchema, request.body);
      const { sessionId, sessionToken } = authOf(request);
      await actAs(db, sessionId, businessId);
      const auth = await loadAuth(db, deps.sessionSecret, sessionToken, deps.now());
      if (!auth) throw new ApiError(401, "unauthorized", "Inicia sesión para continuar");
      return meResponse(auth);
    });

    done();
  };
}
