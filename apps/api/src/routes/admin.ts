import {
  BusinessResponseSchema,
  BusinessSettingsSchema,
  ChatResponseSchema,
  HandoffCodeParamsSchema,
  HandoffDetailSchema,
  HandoffListQuerySchema,
  HandoffListResponseSchema,
  HandoffPatchSchema,
  KnowledgePutSchema,
  KnowledgeResponseSchema,
  MetricsQuerySchema,
  MetricsResponseSchema,
  PreviewChatRequestSchema,
} from "@puente/shared";
import type { FastifyInstance } from "fastify";
import { handleChat, type EngineDeps } from "../engine/pipeline";
import { authOf, requirePanelOrigin, requireRole, requireSession } from "../lib/auth-guard";
import { parseInput } from "../lib/errors";
import {
  getBusiness,
  getHandoff,
  getMetrics,
  listHandoffs,
  listKnowledge,
  replaceKnowledge,
  setHandoffStatus,
  toBusinessResponse,
  updateBusiness,
} from "../services/admin";

export interface AdminRoutesDeps extends EngineDeps {
  sessionSecret: string;
  panelOrigin: string;
  widgetBaseUrl: string;
}

/** Panel API (docs/SPEC.md §4). Every handler scopes queries to the session's business. */
export function adminRoutes(deps: AdminRoutesDeps) {
  return (app: FastifyInstance, _opts: unknown, done: () => void) => {
    const { db } = deps;
    app.addHook("preHandler", requirePanelOrigin(deps.panelOrigin));
    app.addHook("preHandler", requireSession(db, deps.sessionSecret, deps.now));
    const adminOnly = { preHandler: requireRole("ADMIN") };

    app.get("/business", async (request) => {
      const business = await getBusiness(db, authOf(request).businessId);
      return BusinessResponseSchema.parse(toBusinessResponse(business, deps.widgetBaseUrl));
    });

    app.put("/business", adminOnly, async (request) => {
      const settings = parseInput(BusinessSettingsSchema, request.body);
      const business = await updateBusiness(db, authOf(request).businessId, settings);
      return BusinessResponseSchema.parse(toBusinessResponse(business, deps.widgetBaseUrl));
    });

    app.get("/knowledge", adminOnly, async (request) =>
      KnowledgeResponseSchema.parse(await listKnowledge(db, authOf(request).businessId)),
    );

    app.put("/knowledge", adminOnly, async (request) => {
      const { items } = parseInput(KnowledgePutSchema, request.body);
      return KnowledgeResponseSchema.parse(
        await replaceKnowledge(db, authOf(request).businessId, items),
      );
    });

    app.get("/handoffs", async (request) => {
      const { status, cursor } = parseInput(HandoffListQuerySchema, request.query);
      return HandoffListResponseSchema.parse(
        await listHandoffs(db, authOf(request).businessId, status, cursor),
      );
    });

    app.get("/handoffs/:code", async (request) => {
      const { code } = parseInput(HandoffCodeParamsSchema, request.params);
      return HandoffDetailSchema.parse(await getHandoff(db, authOf(request).businessId, code));
    });

    app.patch("/handoffs/:code", async (request) => {
      const { code } = parseInput(HandoffCodeParamsSchema, request.params);
      const { status } = parseInput(HandoffPatchSchema, request.body);
      const auth = authOf(request);
      return HandoffDetailSchema.parse(
        await setHandoffStatus(db, auth.businessId, code, status, auth.userId, deps.now()),
      );
    });

    app.get("/metrics", async (request) => {
      const { from, to } = parseInput(MetricsQuerySchema, request.query);
      const business = await getBusiness(db, authOf(request).businessId);
      return MetricsResponseSchema.parse(await getMetrics(db, business, from, to, deps.now()));
    });

    app.post("/preview-chat", async (request) => {
      const input = parseInput(PreviewChatRequestSchema, request.body);
      const business = await getBusiness(db, authOf(request).businessId);
      const response = await handleChat(deps, input, {
        ip: request.ip,
        log: request.log,
        business,
        originHost: "panel",
        isPreview: true,
      });
      return ChatResponseSchema.parse(response);
    });

    done();
  };
}
