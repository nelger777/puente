import { afterAll, describe, expect, it } from "vitest";
import { newId, newPublicKey } from "../src/lib/ids";
import { testDb } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("database schema", () => {
  it("stores a business with knowledge and cascades deletes", async () => {
    const id = newId("biz");
    await db.business.create({
      data: {
        id,
        slug: `test-${id}`,
        name: "Negocio de prueba",
        kind: "prueba",
        botName: "Bot",
        whatsappNumber: "595981000000",
        notifyEmail: "test@example.com",
        hours: { days: [1, 2, 3, 4, 5], from: "08:00", to: "17:00" },
        offHoursMessage: "Fuera de horario",
        greeting: "Hola",
        sensitiveTopics: [],
        allowedDomains: ["example.com"],
        publicKey: newPublicKey(),
        knowledge: {
          create: [{ id: newId("kb"), question: "¿P?", answer: "R.", position: 0 }],
        },
      },
    });

    const stored = await db.business.findUniqueOrThrow({
      where: { id },
      include: { knowledge: true },
    });
    expect(stored.maxMessagesPerConv).toBe(20);
    expect(stored.suggestions).toEqual([]);
    expect(stored.knowledge).toHaveLength(1);

    await db.business.delete({ where: { id } });
    expect(await db.knowledgeItem.count({ where: { businessId: id } })).toBe(0);
  });
});
