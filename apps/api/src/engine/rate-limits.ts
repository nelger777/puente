import type { Db } from "../db/client";
import type { Business } from "../generated/prisma/client";
import { ApiError } from "../lib/errors";
import { startOfLocalDay } from "../lib/time";

/** Fixed-window counter per IP, in memory (single instance MVP; see docs/DECISIONS.md). */
export class IpRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit = 30,
    private readonly windowMs = 60_000,
  ) {}

  /** Records a hit; returns false when the IP is over the limit. */
  hit(ip: string, now: number): boolean {
    if (this.windows.size > 10_000) this.sweep(now);
    const current = this.windows.get(ip);
    if (!current || now - current.start >= this.windowMs) {
      this.windows.set(ip, { start: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }

  private sweep(now: number): void {
    for (const [ip, w] of this.windows) {
      if (now - w.start >= this.windowMs) this.windows.delete(ip);
    }
  }
}

export async function checkRateLimits(
  db: Db,
  limiter: IpRateLimiter,
  ip: string,
  business: Business,
  now: Date,
): Promise<void> {
  if (!limiter.hit(ip, now.getTime())) {
    throw new ApiError(429, "rate_limited", "Too many requests, try again in a minute");
  }
  const todayMessages = await db.message.count({
    where: {
      role: "USER",
      createdAt: { gte: startOfLocalDay(now, business.timezone) },
      conversation: { businessId: business.id, isPreview: false },
    },
  });
  if (todayMessages >= business.dailyMessageCap) {
    throw new ApiError(429, "rate_limited", "Daily message limit reached for this business");
  }
}
