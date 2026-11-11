import {
  KNOWLEDGE_VERSIONS_KEPT,
  type KnowledgeItemInput,
  type KnowledgeResponse,
  type KnowledgeVersionList,
} from "@puente/shared";
import type { Db } from "../db/client";
import type { Prisma } from "../generated/prisma/client";
import { ApiError } from "../lib/errors";
import { newId } from "../lib/ids";

type Tx = Prisma.TransactionClient;

interface StoredItem {
  question: string;
  answer: string;
  category: string | null;
}

export async function listKnowledge(db: Db | Tx, businessId: string): Promise<KnowledgeResponse> {
  const items = await db.knowledgeItem.findMany({
    where: { businessId },
    orderBy: { position: "asc" },
    select: { id: true, question: true, answer: true, category: true, position: true },
  });
  return { items };
}

async function currentItems(tx: Tx, businessId: string): Promise<StoredItem[]> {
  return tx.knowledgeItem.findMany({
    where: { businessId },
    orderBy: { position: "asc" },
    select: { question: true, answer: true, category: true },
  });
}

const sameItems = (a: StoredItem[], b: StoredItem[]) =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.question === b[i]?.question && x.answer === b[i]?.answer && x.category === b[i]?.category,
  );

/** Keeps the base as it is now as a version, and only the newest ones. */
export async function snapshotKnowledge(
  tx: Tx,
  businessId: string,
  actorUserId: string | null,
  items?: StoredItem[],
): Promise<void> {
  const snapshot = items ?? (await currentItems(tx, businessId));
  await tx.knowledgeVersion.create({
    data: {
      id: newId("kbv"),
      businessId,
      items: snapshot as unknown as Prisma.InputJsonValue,
      itemCount: snapshot.length,
      replacedBy: actorUserId,
    },
  });
  const stale = await tx.knowledgeVersion.findMany({
    where: { businessId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: KNOWLEDGE_VERSIONS_KEPT,
    select: { id: true },
  });
  if (stale.length) {
    await tx.knowledgeVersion.deleteMany({ where: { id: { in: stale.map((v) => v.id) } } });
  }
}

async function writeItems(tx: Tx, businessId: string, items: StoredItem[]): Promise<void> {
  await tx.knowledgeItem.deleteMany({ where: { businessId } });
  await tx.knowledgeItem.createMany({
    data: items.map((item, position) => ({
      id: newId("kb"),
      businessId,
      question: item.question,
      answer: item.answer,
      category: item.category,
      position,
    })),
  });
}

/**
 * Replaces the whole knowledge base atomically (docs/SPEC.md §4). The previous base is kept as
 * a version first, unless the save changes nothing.
 */
export async function replaceKnowledge(
  db: Db,
  businessId: string,
  items: KnowledgeItemInput[],
  actorUserId: string | null,
): Promise<KnowledgeResponse> {
  const next = items.map((i) => ({ question: i.question, answer: i.answer, category: i.category }));
  await db.$transaction(async (tx) => {
    const before = await currentItems(tx, businessId);
    if (sameItems(before, next)) return;
    await snapshotKnowledge(tx, businessId, actorUserId, before);
    await writeItems(tx, businessId, next);
  });
  return listKnowledge(db, businessId);
}

export async function listKnowledgeVersions(
  db: Db,
  businessId: string,
): Promise<KnowledgeVersionList> {
  const versions = await db.knowledgeVersion.findMany({
    where: { businessId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: KNOWLEDGE_VERSIONS_KEPT,
    select: { id: true, createdAt: true, itemCount: true, replacedBy: true },
  });
  const userIds = [...new Set(versions.flatMap((v) => (v.replacedBy ? [v.replacedBy] : [])))];
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true },
  });
  const email = new Map(users.map((u) => [u.id, u.email]));
  return {
    versions: versions.map((v) => ({
      id: v.id,
      createdAt: v.createdAt.toISOString(),
      itemCount: v.itemCount,
      replacedBy: (v.replacedBy && email.get(v.replacedBy)) ?? null,
    })),
  };
}

/** Puts a kept version back. The base it replaces becomes a version too, so this can be undone. */
export async function restoreKnowledgeVersion(
  db: Db,
  businessId: string,
  versionId: string,
  actorUserId: string,
): Promise<KnowledgeResponse> {
  await db.$transaction(async (tx) => {
    const version = await tx.knowledgeVersion.findFirst({ where: { id: versionId, businessId } });
    if (!version) throw new ApiError(404, "not_found", "Version not found");
    const items = version.items as unknown as StoredItem[];
    await snapshotKnowledge(tx, businessId, actorUserId);
    await writeItems(tx, businessId, items);
  });
  return listKnowledge(db, businessId);
}
