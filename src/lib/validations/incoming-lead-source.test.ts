import { describe, it, expect } from "vitest";
import { incomingLeadSchema } from "./rebuild-f1";

// Cada adapter de conector produce un `source`; todos deben ser aceptados por incomingLeadSchema,
// o captureLead descarta el lead silenciosamente.
describe("incomingLeadSchema acepta los source de todos los conectores", () => {
  for (const source of ["FACEBOOK_ADS", "INSTAGRAM", "MESSENGER", "TIKTOK_ADS", "GOOGLE_ADS", "LINKEDIN", "WEBSITE"]) {
    it(`acepta source=${source}`, () => {
      const r = incomingLeadSchema.safeParse({ firstName: "Ana", lastName: "L", phone: "+529981234567", source });
      expect(r.success).toBe(true);
    });
  }
});

// #907: contactType de los leads entrantes (conectores). REFERIDOR se retiró, pero una
// integración configurada antes puede seguir mandándolo: entra como Broker, no tumba el lead.
describe("incomingLeadSchema — contactType (#907)", () => {
  const BASE = { firstName: "Ana", lastName: "L", phone: "+529981234567", source: "WEBSITE" };

  it("REFERIDOR → BROKER_EXTERNO", () => {
    const r = incomingLeadSchema.safeParse({ ...BASE, contactType: "REFERIDOR" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contactType).toBe("BROKER_EXTERNO");
  });

  it("acepta Proveedor y Otro; sin contactType sigue siendo opcional", () => {
    for (const t of ["PROVEEDOR", "OTRO"]) {
      const r = incomingLeadSchema.safeParse({ ...BASE, contactType: t });
      expect(r.success, t).toBe(true);
    }
    const sin = incomingLeadSchema.safeParse(BASE);
    expect(sin.success).toBe(true);
    if (sin.success) expect(sin.data.contactType).toBeUndefined();
  });

  it("un valor inventado se sigue rechazando", () => {
    expect(incomingLeadSchema.safeParse({ ...BASE, contactType: "VENDEDOR" }).success).toBe(false);
  });
});

describe("incomingLeadSchema — retirados del #929", () => {
  const BASE = { firstName: "Ana", lastName: "L", phone: "+529981234567" };

  it("source REFERIDO_BROKER → REGISTRO_BROKER (y REGISTRO_BROKER ya se acepta)", () => {
    const r = incomingLeadSchema.safeParse({ ...BASE, source: "REFERIDO_BROKER" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.source).toBe("REGISTRO_BROKER");
    expect(incomingLeadSchema.safeParse({ ...BASE, source: "REGISTRO_BROKER" }).success).toBe(true);
  });

  it("contactType REFERIDO → sin tipo, sin tumbar el lead", () => {
    const r = incomingLeadSchema.safeParse({ ...BASE, source: "WEBSITE", contactType: "REFERIDO" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contactType).toBeUndefined();
  });
});
