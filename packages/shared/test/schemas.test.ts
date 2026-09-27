import { describe, expect, it } from "vitest";
import {
  BusinessHoursSchema,
  HANDOFF_REASON_LABELS,
  HandoffCodeSchema,
  HandoffReasonSchema,
  LLM_REASON_TO_HANDOFF_REASON,
  LlmHandoffReasonSchema,
  WhatsappNumberSchema,
} from "../src";

describe("handoff reasons", () => {
  it("maps every LLM reason to a server reason", () => {
    for (const reason of LlmHandoffReasonSchema.options) {
      expect(HandoffReasonSchema.options).toContain(LLM_REASON_TO_HANDOFF_REASON[reason]);
    }
  });

  it("has a UI label for every reason", () => {
    expect(Object.keys(HANDOFF_REASON_LABELS).sort()).toEqual(
      [...HandoffReasonSchema.options].sort(),
    );
  });

  it("does not let the LLM pick server-only reasons", () => {
    expect(LlmHandoffReasonSchema.safeParse("limite").success).toBe(false);
    expect(LlmHandoffReasonSchema.safeParse("falla_tecnica").success).toBe(false);
  });
});

describe("handoff code", () => {
  it.each(["DER-4821", "DER-123456"])("accepts %s", (code) => {
    expect(HandoffCodeSchema.safeParse(code).success).toBe(true);
  });
  it.each(["DER-123", "DER-1234567", "der-4821", "DER-48a1"])("rejects %s", (code) => {
    expect(HandoffCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("business fields", () => {
  it("validates opening hours", () => {
    expect(
      BusinessHoursSchema.safeParse({ days: [1, 2, 3], from: "08:00", to: "17:30" }).success,
    ).toBe(true);
    expect(BusinessHoursSchema.safeParse({ days: [7], from: "08:00", to: "17:30" }).success).toBe(
      false,
    );
    expect(BusinessHoursSchema.safeParse({ days: [1], from: "18:00", to: "08:00" }).success).toBe(
      false,
    );
  });

  it("accepts only digits for WhatsApp numbers", () => {
    expect(WhatsappNumberSchema.safeParse("595981123456").success).toBe(true);
    expect(WhatsappNumberSchema.safeParse("+595 981 123456").success).toBe(false);
  });
});
