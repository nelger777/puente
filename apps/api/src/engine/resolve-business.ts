import type { Db } from "../db/client";
import type { Business } from "../generated/prisma/client";
import { ApiError } from "../lib/errors";

const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function normalizeDomain(entry: string): string {
  return entry
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[:/].*$/, "");
}

/** Returns the origin's hostname when it is authorized for the business, otherwise null. */
export function allowedOriginHost(
  origin: string | undefined,
  allowedDomains: string[],
  allowLocalhost: boolean,
): string | null {
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (allowLocalhost && DEV_HOSTS.has(host)) return host;
  return allowedDomains.some((d) => normalizeDomain(d) === host) ? host : null;
}

export async function resolveBusiness(
  db: Db,
  key: string,
  origin: string | undefined,
  allowLocalhost: boolean,
): Promise<{ business: Business; originHost: string }> {
  const business = await db.business.findUnique({ where: { publicKey: key } });
  if (!business?.active) {
    throw new ApiError(404, "business_not_found", "Business not found");
  }
  const originHost = allowedOriginHost(origin, business.allowedDomains, allowLocalhost);
  if (!originHost) {
    throw new ApiError(403, "origin_not_allowed", "Origin not allowed for this business");
  }
  return { business, originHost };
}
