import { describe, it, expect } from "vitest";
import { mergeProfileDefaults } from "./connectors";

describe("mergeProfileDefaults", () => {
  it("el valor explícito del mapeo gana sobre el heurístico (no lo pisa)", () => {
    const fields = { investmentProfile: "INVESTOR_FLIP" };
    const profileFields = { investmentProfile: "END_USER" };
    expect(mergeProfileDefaults(fields, profileFields)).toEqual({ investmentProfile: "INVESTOR_FLIP" });
  });

  it("rellena solo las claves faltantes (undefined/null/\"\")", () => {
    const fields: Record<string, unknown> = {
      investmentProfile: undefined,
      propertyType: null,
      rentalStrategy: "",
      purchaseTimeline: "IMMEDIATE",
    };
    const profileFields = {
      investmentProfile: "INVESTOR_RENTAL",
      propertyType: "DEPARTAMENTO",
      rentalStrategy: "AIRBNB",
      purchaseTimeline: "SIX_PLUS_MONTHS",
    };
    expect(mergeProfileDefaults(fields, profileFields)).toEqual({
      investmentProfile: "INVESTOR_RENTAL",
      propertyType: "DEPARTAMENTO",
      rentalStrategy: "AIRBNB",
      purchaseTimeline: "IMMEDIATE", // explícito, no se pisa
    });
  });

  it("con profileFields vacío no modifica fields", () => {
    const fields = { investmentProfile: "MIXED" };
    expect(mergeProfileDefaults(fields, {})).toEqual({ investmentProfile: "MIXED" });
  });

  it("muta y retorna el mismo objeto fields", () => {
    const fields: Record<string, unknown> = {};
    const result = mergeProfileDefaults(fields, { investmentProfile: "END_USER" });
    expect(result).toBe(fields);
    expect(fields.investmentProfile).toBe("END_USER");
  });
});
