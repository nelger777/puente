import { describe, expect, it } from "vitest";
import { toCsv } from "../src/lib/csv";

describe("toCsv", () => {
  it("uses ; with a BOM and quotes only what needs it", () => {
    expect(
      toCsv([
        ["Semana", "Conversaciones"],
        ["2026-11-09", 12],
        ['Dice "hola"; chau', "a\nb"],
      ]),
    ).toBe('﻿Semana;Conversaciones\r\n2026-11-09;12\r\n"Dice ""hola""; chau";"a\nb"\r\n');
  });
});
