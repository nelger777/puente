import type { UserRole } from "@puente/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/client";
import { findSession, SESSION_COOKIE } from "../services/auth";
import { ApiError } from "./errors";

export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
  platformAdmin: boolean;
  /** The business every panel query is scoped to: the user's own, or the one a platform admin entered. */
  businessId: string;
  businessName: string;
  sessionId: string;
  sessionToken: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** Resolves the session's cookie into the request's AuthContext, or null if it is not valid. */
export async function loadAuth(
  db: Db,
  secret: string,
  token: string,
  now: Date,
): Promise<AuthContext | null> {
  const session = await findSession(db, secret, token, now);
  if (!session) return null;
  const { user } = session;
  // Only a platform admin can act on another business, and always does it as its ADMIN.
  const acting = user.isPlatformAdmin ? session.actingBusiness : null;
  const business = acting ?? user.business;
  return {
    userId: user.id,
    email: user.email,
    role: acting ? "ADMIN" : user.role,
    platformAdmin: user.isPlatformAdmin,
    businessId: business.id,
    businessName: business.name,
    sessionId: session.id,
    sessionToken: token,
  };
}

export function requireSession(db: Db, secret: string, now: () => Date) {
  return async (request: FastifyRequest): Promise<void> => {
    const token = request.cookies[SESSION_COOKIE];
    const auth = token ? await loadAuth(db, secret, token, now()) : null;
    if (!auth) throw new ApiError(401, "unauthorized", "Inicia sesión para continuar");
    request.auth = auth;
  };
}

/** Use after requireSession. */
export function requireRole(role: UserRole) {
  return (request: FastifyRequest): Promise<void> =>
    request.auth?.role === role
      ? Promise.resolve()
      : Promise.reject(new ApiError(403, "forbidden", "No tienes permiso para esta acción"));
}

/** Use after requireSession. */
export function requirePlatformAdmin(request: FastifyRequest): Promise<void> {
  return request.auth?.platformAdmin
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
