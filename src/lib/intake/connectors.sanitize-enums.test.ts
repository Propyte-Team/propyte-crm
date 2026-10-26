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

describe("sanitizeEnumFields — tipos retirados (#907)", () => {
  it("un REFERIDOR de una integración vieja entra como Broker, no se descarta", () => {
    const fields: Record<string, unknown> = { contactType: "REFERIDOR" };
    const dropped = sanitizeEnumFields(fields);
    expect(fields).toEqual({ contactType: "BROKER_EXTERNO" });
    expect(dropped).toEqual([]);
  });

  it("Proveedor y Otro son válidos", () => {
    for (const t of ["PROVEEDOR", "OTRO"]) {
      const fields: Record<string, unknown> = { contactType: t };
      expect(sanitizeEnumFields(fields)).toEqual([]);
      expect(fields.contactType).toBe(t);
    }
  });

  it("VALID_ENUMS.contactType ya no incluye REFERIDOR", () => {
    expect(VALID_ENUMS.contactType).not.toContain("REFERIDOR");
  });
});

describe("sanitizeEnumFields — retirados del #929", () => {
  it("source REFERIDO_BROKER entra como REGISTRO_BROKER", () => {
    const fields: Record<string, unknown> = { source: "REFERIDO_BROKER" };
    expect(sanitizeEnumFields(fields)).toEqual([]);
    expect(fields).toEqual({ source: "REGISTRO_BROKER" });
  });

  it("contactType REFERIDO se quita (nace sin tipo) y no se reporta como inválido", () => {
    const fields: Record<string, unknown> = { contactType: "REFERIDO", firstName: "Ana" };
    expect(sanitizeEnumFields(fields)).toEqual([]);
    expect(fields).toEqual({ firstName: "Ana" });
  });
});
