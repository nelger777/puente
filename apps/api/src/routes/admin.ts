import {
  AvatarUploadSchema,
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
  LlmSettingsSchema,
  LlmTestResponseSchema,
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
  type LlmPrices,
} from "../services/admin";
import { avatarUpdatedAt, avatarUrl, removeAvatar, saveAvatar } from "../services/avatar";
import type { Business } from "../generated/prisma/client";
import type { SecretBox } from "../lib/secrets";
import { testLlm, updateLlmSettings } from "../services/llm-settings";

export interface AdminRoutesDeps extends EngineDeps {
  sessionSecret: string;
  panelOrigin: string;
  widgetBaseUrl: string;
  publicApiUrl: string;
  prices: LlmPrices;
  /** Seals the per-business AI keys; null when SECRETS_KEY is not set. */
  secrets: SecretBox | null;
}

/** Panel API (docs/SPEC.md §4). Every handler scopes queries to the session's business. */
export function adminRoutes(deps: AdminRoutesDeps) {
  return (app: FastifyInstance, _opts: unknown, done: () => void) => {
    const { db } = deps;
    app.addHook("preHandler", requirePanelOrigin(deps.panelOrigin));
    app.addHook("preHandler", requireSession(db, deps.sessionSecret, deps.now));
    const adminOnly = { preHandler: requireRole("ADMIN") };

    async function businessResponse(business: Business) {
      const picture = avatarUrl(
        deps.publicApiUrl,
        business.publicKey,
        await avatarUpdatedAt(db, business.id),
      );
      return BusinessResponseSchema.parse(
        toBusinessResponse(business, deps.widgetBaseUrl, picture),
      );
    }

    app.get("/business", async (request) =>
      businessResponse(await getBusiness(db, authOf(request).businessId)),
    );

    app.put("/business", adminOnly, async (request) => {
      const settings = parseInput(BusinessSettingsSchema, request.body);
      return businessResponse(await updateBusiness(db, authOf(request).businessId, settings));
    });

    // The picture travels as a data URL: up to 200 KB of image, ~270 KB once encoded.
    app.put("/business/avatar", { ...adminOnly, bodyLimit: 512 * 1024 }, async (request) => {
      const { dataUrl } = parseInput(AvatarUploadSchema, request.body);
      const { businessId } = authOf(request);
      await saveAvatar(db, businessId, dataUrl);
      return businessResponse(await getBusiness(db, businessId));
    });

    app.delete("/business/avatar", adminOnly, async (request) => {
      const { businessId } = authOf(request);
      await removeAvatar(db, businessId);
      return businessResponse(await getBusiness(db, businessId));
    });

    // The key is write-only: the response only says whether one is saved and its last 4 chars.
    app.put("/business/llm", adminOnly, async (request) => {
      const settings = parseInput(LlmSettingsSchema, request.body);
      const business = await getBusiness(db, authOf(request).businessId);
      return businessResponse(await updateLlmSettings(db, business, settings, deps.secrets));
    });

    app.post("/business/llm/test", adminOnly, async (request) => {
      const business = await getBusiness(db, authOf(request).businessId);
      return LlmTestResponseSchema.parse(await testLlm(business, deps.llmFor, deps.llmTimeoutMs));
    });

    app.get("/knowledge", adminOnly, async (request) =>
      KnowledgeResponseSchema.parse(await listKnowledge(db, authOf(request).businessId)),
    );

    // A full knowledge base (200 × ~2,300 chars) is far above the global 16 KB body limit.
    app.put("/knowledge", { ...adminOnly, bodyLimit: 1024 * 1024 }, async (request) => {
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
      return MetricsResponseSchema.parse(
        await getMetrics(db, business, from, to, deps.now(), deps.prices),
      );
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
