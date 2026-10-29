import { describe, it, expect } from "vitest";
import { tieneCicloDeVida } from "./constants";

describe("tieneCicloDeVida (#863, #938)", () => {
  it("leads, referidos y contactos SIN tipo llevan ciclo de vida", () => {
    for (const t of ["LEAD_COMPRADOR", "LEAD_VENDEDOR", "REFERIDO_DE_BROKER", "REFERIDO_DE_CLIENTE"]) {
      expect(tieneCicloDeVida(t), t).toBe(true);
    }
    // Antes todos nacían COMPRADOR; sin esto, los prospectos nuevos dejarían de avanzar a MQL.
    expect(tieneCicloDeVida(null)).toBe(true);
    expect(tieneCicloDeVida(undefined)).toBe(true);
  });

  it("#938: un tipo retirado se evalúa como su reemplazo (Lead Comprador)", () => {
    // Entre el despliegue y la migración de datos, un Comprador no puede perder su ciclo.
    for (const t of ["COMPRADOR", "INVERSIONISTA", "LEAD"]) {
      expect(tieneCicloDeVida(t), t).toBe(true);
    }
  });

  it("brokers, empleo, proveedores, otros, referidores, prospectos y clientes no", () => {
    for (const t of ["BROKER_EXTERNO", "EMPLEO", "PROVEEDOR", "OTRO", "REFERIDOR", "REFERIDO", "PROSPECTO", "CLIENTE"]) {
      expect(tieneCicloDeVida(t), t).toBe(false);
    }
  });
});
