import { describe, it, expect } from "vitest";
import { sanitizeEnumFields, VALID_ENUMS } from "./connectors";

describe("sanitizeEnumFields", () => {
  it("descarta un contactType inválido y lo reporta", () => {
    const fields: Record<string, unknown> = { contactType: "Comprador residencial", firstName: "Ana" };
    const dropped = sanitizeEnumFields(fields);
    expect(fields).toEqual({ firstName: "Ana" });
    expect(dropped).toEqual(["contactType=Comprador residencial"]);
  });

  it("conserva un valor de enum válido", () => {
    const fields: Record<string, unknown> = { contactType: "COMPRADOR", temperature: "HOT" };
    const dropped = sanitizeEnumFields(fields);
    expect(fields).toEqual({ contactType: "COMPRADOR", temperature: "HOT" });
    expect(dropped).toEqual([]);
  });

  it("no toca campos que no son enum", () => {
    const fields: Record<string, unknown> = { firstName: "Ana", phone: "+529991234567", custom: { a: 1 } };
    const dropped = sanitizeEnumFields(fields);
    expect(fields).toEqual({ firstName: "Ana", phone: "+529991234567", custom: { a: 1 } });
    expect(dropped).toEqual([]);
  });

  it("ignora string vacío en un campo enum (no lo marca como inválido)", () => {
    const fields: Record<string, unknown> = { contactType: "" };
    const dropped = sanitizeEnumFields(fields);
    expect(fields).toEqual({ contactType: "" });
    expect(dropped).toEqual([]);
  });

  it("detecta varios enums inválidos en el mismo lead", () => {
    const fields: Record<string, unknown> = {
      contactType: "COMPRADOR",
      source: "FACEBOOK ADS", // inválido (espacio en vez de _)
      temperature: "TIBIO", // inválido
    };
    const dropped = sanitizeEnumFields(fields);
    expect(fields).toEqual({ contactType: "COMPRADOR" });
    expect(dropped.sort()).toEqual(["source=FACEBOOK ADS", "temperature=TIBIO"].sort());
  });

  it("todas las claves de VALID_ENUMS coinciden con incomingLeadSchema (source es subconjunto documentado)", () => {
    expect(Object.keys(VALID_ENUMS).sort()).toEqual(
      [
        "contactType",
        "temperature",
        "language",
        "source",
        "investmentProfile",
        "propertyType",
        "purchaseTimeline",
        "paymentMethod",
        "purchaseModality",
        "rentalStrategy",
      ].sort()
    );
  });
});
