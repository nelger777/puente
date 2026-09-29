import { BusinessSettingsSchema, estimateTokens, KnowledgePutSchema } from "@puente/shared";
import { describe, expect, it } from "vitest";
import laRural from "../prisma/businesses/la-rural.json";
import opticaMirador from "../prisma/businesses/optica-mirador.json";

describe.each([
  ["optica-mirador", opticaMirador],
  ["la-rural", laRural],
])("business file %s", (_slug, file) => {
  it("passes the same validation as the panel", () => {
    expect(BusinessSettingsSchema.safeParse(file.settings).success).toBe(true);
    expect(KnowledgePutSchema.safeParse({ items: file.knowledge }).success).toBe(true);
  });

  it("keeps the knowledge base small enough for cheap messages", () => {
    const chars = file.knowledge.reduce((n, k) => n + k.question.length + k.answer.length, 0);
    expect(estimateTokens(chars)).toBeLessThan(5_000);
  });
});

describe("La Rural", () => {
  it("hands off to the direct-to-human corporate WhatsApp and speaks with vos", () => {
    expect(laRural.settings.whatsappNumber).toBe("595974590950");
    expect(laRural.settings.voice).toBe("vos");
    expect(laRural.settings.hours).toEqual({ days: [1, 2, 3, 4, 5], from: "08:00", to: "17:30" });
  });

  it("lists every placeholder that must be replaced before production", () => {
    expect(laRural._datosFicticios.length).toBeGreaterThan(0);
    const links = laRural.knowledge.flatMap((k) => k.answer.match(/https:\/\/[^\s,]+/g) ?? []);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toMatch(/^https:\/\/www\.larural\.com\.py\//);
  });

  it("sends complaints straight to a person but lets claim reports reach the knowledge base", () => {
    expect(laRural.settings.sensitiveTopics).toContain("reclamo");
    // "denuncia" is how customers report a claim (siniestro): it must not skip the assistant.
    expect(laRural.settings.sensitiveTopics).not.toContain("denuncia");
  });
});
