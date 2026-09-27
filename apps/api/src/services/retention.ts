import type { Db } from "../db/client";

export interface RetentionResult {
  conversations: number;
  sessions: number;
  cutoff: Date;
}

/**
 * Privacy retention (docs/SPEC.md §8): conversations idle for more than `days` are deleted
 * with their messages, handoffs (pending ones too) and events via cascade. Expired panel
 * sessions go as well. Returns counts only; never log contents.
 */
export async function runRetention(db: Db, days: number, now: Date): Promise<RetentionResult> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const [conversations, sessions] = await db.$transaction([
    db.conversation.deleteMany({ where: { lastMessageAt: { lt: cutoff } } }),
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return { conversations: conversations.count, sessions: sessions.count, cutoff };
}
