import type { BusinessResponse } from "@puente/shared";
import { describe, expect, it } from "vitest";
import { fromForm, toForm } from "../src/lib/settings-form";

const BUSINESS: BusinessResponse = {
  id: "biz_1",
  slug: "optica",
  publicKey: "pk_demo_opticamirador",
  widgetScriptUrl: "https://puente.test/widget/v1.js",
  name: "Óptica Mirador",
  kind: "óptica",
  botName: "Luz",
  brandColor: "#1F5FBF",
  whatsappNumber: "595981000000",
  notifyEmail: "equipo@opticamirador.com",
  timezone: "America/Asuncion",
  hours: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "18:00" },
  offHoursMessage: "Volvemos mañana.",
  greeting: "¡Hola!",
  suggestions: ["¿Horario?", "Hablar con una persona"],
  sensitiveTopics: ["reclamo"],
  allowedDomains: ["opticamirador.com"],
  maxMessagesPerConv: 20,
  dailyMessageCap: 2000,
  active: true,
};

describe("settings form", () => {
  it("round-trips the business settings", () => {
    const result = fromForm(toForm(BUSINESS));
    expect(result).toMatchObject({
      ok: true,
      settings: {
        suggestions: ["¿Horario?", "Hablar con una persona"],
        hours: BUSINESS.hours,
        maxMessagesPerConv: 20,
      },
    });
  });

  it("accepts lists separated by lines or commas and cleans the phone", () => {
    const form = {
      ...toForm(BUSINESS),
      sensitiveTopics: "reclamo, garantía\nreembolso",
      whatsappNumber: "+595 981 000-000",
    };
    const result = fromForm(form);
    if (!result.ok) throw new Error("expected valid");
    expect(result.settings.sensitiveTopics).toEqual(["reclamo", "garantía", "reembolso"]);
    expect(result.settings.whatsappNumber).toBe("595981000000");
  });

  it("points errors to the right fields", () => {
    const result = fromForm({
      ...toForm(BUSINESS),
      timezone: "Luna/Base",
      from: "19:00",
      allowedDomains: "https://tienda.com/",
      maxMessagesPerConv: "0",
    });
    if (result.ok) throw new Error("expected errors");
    expect(Object.keys(result.errors).sort()).toEqual(
      ["allowedDomains", "maxMessagesPerConv", "timezone", "to"].sort(),
    );
    expect(result.errors.timezone).toBe("Zona horaria inválida");
  });
});
