import { SlugSchema } from "@puente/shared";
import { describe, expect, it } from "vitest";
import { slugify } from "../src/lib/slug";

describe("slugify", () => {
  it("drops accents, spaces and symbols", () => {
    expect(slugify("Óptica del Sol")).toBe("optica-del-sol");
    expect(slugify("  Ferretería & Pinturería Nº 1 ")).toBe("ferreteria-pintureria-n-1");
  });

  it("always produces a slug the API accepts", () => {
    const long = slugify("Una empresa con un nombre larguísimo que no entra en cuarenta");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(SlugSchema.safeParse(long).success).toBe(true);
    expect(SlugSchema.safeParse(slugify("La Rural Seguros S.A.")).success).toBe(true);
  });
});
