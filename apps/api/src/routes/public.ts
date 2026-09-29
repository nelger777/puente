import {
  ChatRequestSchema,
  ChatResponseSchema,
  HandoffCodeParamsSchema,
  HandoffContactRequestSchema,
  HandoffEventRequestSchema,
  WidgetConfigQuerySchema,
  WidgetConfigResponseSchema,
  type WidgetConfigResponse,
} from "@puente/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/client";
import { businessHours, businessVoice } from "../engine/business";
import { findHandoffForCustomer } from "../engine/handoff";
import { handleChat, type EngineDeps } from "../engine/pipeline";
import type { IpRateLimiter } from "../engine/rate-limits";
import { resolveBusiness } from "../engine/resolve-business";
import { ApiError, parseInput } from "../lib/errors";
import { newId } from "../lib/ids";
import { isInHours } from "../lib/time";
import { avatarUpdatedAt, avatarUrl } from "../services/avatar";

export interface PublicRoutesDeps extends EngineDeps {
  allowLocalhost: boolean;
  publicApiUrl: string;
}

/**
 * Widget endpoints. Auth = public key + Origin in the business allowedDomains; the CORS
 * allow-origin header is only sent once the origin has been authorized for that key.
 */
export function publicRoutes(deps: PublicRoutesDeps) {
  return (app: FastifyInstance, _opts: unknown, done: () => void) => {
    // Preflight carries no key, so it cannot be authorized here; it grants nothing by itself
    // because the real response only exposes itself to authorized origins.
    app.options("/*", async (request, reply) => {
      const origin = request.headers.origin;
      if (origin) {
        reply
          .header("access-control-allow-origin", origin)
          .header("access-control-allow-methods", "GET, POST")
          .header("access-control-allow-headers", "content-type")
          .header("access-control-max-age", "600");
      }
      return reply.header("vary", "Origin").code(204).send();
    });

    async function authorize(request: FastifyRequest, reply: FastifyReply, key: string) {
      const resolved = await resolveBusiness(
        deps.db,
        key,
        request.headers.origin,
        deps.allowLocalhost,
      );
      reply.header("access-control-allow-origin", request.headers.origin).header("vary", "Origin");
      return resolved;
    }

    app.get("/widget/config", async (request, reply) => {
      const { key } = parseInput(WidgetConfigQuerySchema, request.query);
      const { business } = await authorize(request, reply, key);
      const body: WidgetConfigResponse = {
        businessName: business.name,
        botName: business.botName,
        avatarUrl: avatarUrl(
          deps.publicApiUrl,
          business.publicKey,
          await avatarUpdatedAt(deps.db, business.id),
        ),
        voice: businessVoice(business),
        brandColor: business.brandColor,
        greeting: business.greeting,
        suggestions: business.suggestions,
        inHours: isInHours(businessHours(business), business.timezone, deps.now()),
      };
      return WidgetConfigResponseSchema.parse(body);
    });

    // The assistant picture, loaded by <img> on any site: public like the business name, so no
    // origin check; only images whose real type was verified at upload are ever stored.
    app.get("/widget/avatar/:key", async (request, reply) => {
      const { key } = parseInput(WidgetConfigQuerySchema, request.params);
      const business = await deps.db.business.findUnique({
        where: { publicKey: key },
        select: { active: true, avatar: { select: { mimeType: true, data: true } } },
      });
      if (!business?.active || !business.avatar) {
        throw new ApiError(404, "not_found", "No picture");
      }
      return reply
        .header("content-type", business.avatar.mimeType)
        .header("cache-control", "public, max-age=86400")
        .header("cross-origin-resource-policy", "cross-origin")
        .header("content-security-policy", "default-src 'none'")
        .send(Buffer.from(business.avatar.data));
    });

    app.post("/chat", async (request, reply) => {
      const input = parseInput(ChatRequestSchema, request.body);
      const { business, originHost } = await authorize(request, reply, input.key);
      const response = await handleChat(deps, input, {
        ip: request.ip,
        log: request.log,
        business,
        originHost,
      });
      return ChatResponseSchema.parse(response);
    });

    app.post("/handoffs/:code/contact", async (request, reply) => {
      const { code } = parseInput(HandoffCodeParamsSchema, request.params);
      const input = parseInput(HandoffContactRequestSchema, request.body);
      const { business } = await authorize(request, reply, input.key);
      limitIp(deps.limiter, request.ip, deps.now());
      const found = await customerHandoff(deps.db, business.id, code, input.conversationToken);

      const handoff = await deps.db.handoff.update({
        where: { id: found.handoff.id },
        data: { contactName: input.name || null, contactPhone: input.phone },
      });
      await deps.db.handoffEvent.create({
        data: {
          id: newId("hev"),
          handoffId: handoff.id,
          type: "contact_requested",
          actor: "customer",
        },
      });
      if (!found.isPreview) deps.notifier.contactRequested(business, handoff);
      return reply.code(204).send();
    });

    app.post("/handoffs/:code/events", async (request, reply) => {
      const { code } = parseInput(HandoffCodeParamsSchema, request.params);
      const input = parseInput(HandoffEventRequestSchema, request.body);
      const { business } = await authorize(request, reply, input.key);
      limitIp(deps.limiter, request.ip, deps.now());
      const found = await customerHandoff(deps.db, business.id, code, input.conversationToken);

      await deps.db.handoffEvent.create({
        data: {
          id: newId("hev"),
          handoffId: found.handoff.id,
          type: input.type,
          actor: "customer",
        },
      });
      return reply.code(204).send();
    });

    done();
  };
}

function limitIp(limiter: IpRateLimiter, ip: string, now: Date): void {
  if (!limiter.hit(ip, now.getTime())) {
    throw new ApiError(429, "rate_limited", "Too many requests, try again in a minute");
  }
}

async function customerHandoff(db: Db, businessId: string, code: string, token: string) {
  const found = await findHandoffForCustomer(db, businessId, code, token);
  if (!found) throw new ApiError(404, "handoff_not_found", "Handoff not found");
  return found;
}
