import { randomBytes } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";

export const ID_PREFIXES = {
  business: "biz",
  knowledgeItem: "kb",
  conversation: "conv",
  message: "msg",
  handoff: "hof",
  handoffEvent: "hev",
  user: "usr",
  session: "ses",
} as const;
export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${createId()}`;
}

/** Public widget key: not a secret, but unguessable so businesses can't be enumerated. */
export function newPublicKey(): string {
  return `pk_${randomBytes(18).toString("base64url")}`;
}
