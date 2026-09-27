import type { UserRole } from "@puente/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/client";
import { findSession, SESSION_COOKIE } from "../services/auth";
import { ApiError } from "./errors";

export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
  businessId: string;
  businessName: string;
  sessionToken: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function requireSession(db: Db, secret: string, now: () => Date) {
  return async (request: FastifyRequest): Promise<void> => {
    const token = request.cookies[SESSION_COOKIE];
    const session = token ? await findSession(db, secret, token, now()) : null;
    if (!token || !session) throw new ApiError(401, "unauthorized", "Inicia sesión para continuar");
    request.auth = {
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role,
      businessId: session.user.business.id,
      businessName: session.user.business.name,
      sessionToken: token,
    };
  };
}

/** Use after requireSession. */
export function requireRole(role: UserRole) {
  return (request: FastifyRequest): Promise<void> =>
    request.auth?.role === role
      ? Promise.resolve()
      : Promise.reject(new ApiError(403, "forbidden", "No tienes permiso para esta acción"));
}

/** Narrowing helper for handlers behind requireSession. */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new ApiError(401, "unauthorized", "Inicia sesión para continuar");
  return request.auth;
}

/**
 * CSRF defense in depth (the cookie is already SameSite=Lax): state-changing requests
 * from a browser must come from the panel's own origin.
 */
export function requirePanelOrigin(panelOrigin: string) {
  return (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const origin = request.headers.origin;
    const safe = request.method === "GET" || request.method === "HEAD";
    if (!safe && origin !== undefined && origin !== panelOrigin) {
      return Promise.reject(new ApiError(403, "forbidden", "Origen no permitido"));
    }
    return Promise.resolve();
  };
}
