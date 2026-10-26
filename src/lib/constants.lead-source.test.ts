import { describe, it, expect } from "vitest";
import { LeadSource } from "@prisma/client";
import { LEAD_SOURCE_ORDER, LEAD_SOURCE_LABELS, LEAD_SOURCE_RETIRADAS, normalizarFuente } from "./constants";

// AUD-20260710-02: el alta de contacto ofrecía 12/21 fuentes y había 3 mapas de labels
// desincronizados. Única fuente de verdad = LEAD_SOURCE_ORDER (patrón CONTACT_STATUS_ORDER):
// alimenta los selects (alta/filtro/detalle) y los z.enum de las APIs.
describe("LEAD_SOURCE_ORDER — paridad con el enum LeadSource de Prisma", () => {
  it("vigentes + retiradas cubren TODOS los valores del enum (ni más ni menos)", () => {
    const todas = [...LEAD_SOURCE_ORDER, ...Object.keys(LEAD_SOURCE_RETIRADAS)];
    expect(todas.sort()).toEqual(Object.values(LeadSource).sort());
  });

  it("#929: «Referido de Broker» se retiró y se traduce a «Registro de Broker»", () => {
    expect(LEAD_SOURCE_ORDER as readonly string[]).not.toContain("REFERIDO_BROKER");
    expect(LEAD_SOURCE_ORDER as readonly string[]).toContain("REGISTRO_BROKER");
    expect(normalizarFuente("REFERIDO_BROKER")).toBe("REGISTRO_BROKER");
    expect(normalizarFuente("MESSENGER")).toBe("MESSENGER");
    expect(normalizarFuente("toString")).toBe("toString");
    for (const [vieja, nueva] of Object.entries(LEAD_SOURCE_RETIRADAS)) {
      expect(LEAD_SOURCE_ORDER as readonly string[]).not.toContain(vieja);
      expect(LEAD_SOURCE_ORDER as readonly string[]).toContain(nueva);
    }
  });

  it("cada fuente tiene label en español", () => {
    for (const v of LEAD_SOURCE_ORDER) {
      expect(LEAD_SOURCE_LABELS[v], `falta label para ${v}`).toBeTruthy();
    }
  });

  it("no hay labels huérfanos (label sin valor en el enum)", () => {
    const valid = new Set(Object.values(LeadSource) as string[]);
    for (const key of Object.keys(LEAD_SOURCE_LABELS)) {
      expect(valid.has(key), `label huérfano: ${key}`).toBe(true);
    }
  });
});
