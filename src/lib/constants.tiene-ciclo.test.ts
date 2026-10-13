import { describe, it, expect } from "vitest";
import { tieneCicloDeVida } from "./constants";

describe("tieneCicloDeVida (#863)", () => {
  it("compradores, inversionistas y contactos SIN tipo llevan ciclo de vida", () => {
    expect(tieneCicloDeVida("COMPRADOR")).toBe(true);
    expect(tieneCicloDeVida("INVERSIONISTA")).toBe(true);
    // Antes todos nacían COMPRADOR; sin esto, los prospectos nuevos dejarían de avanzar a MQL.
    expect(tieneCicloDeVida(null)).toBe(true);
    expect(tieneCicloDeVida(undefined)).toBe(true);
  });

  it("brokers, empleo, referidores y clientes no", () => {
    for (const t of ["BROKER_EXTERNO", "EMPLEO", "REFERIDOR", "CLIENTE", "LEAD"]) {
      expect(tieneCicloDeVida(t)).toBe(false);
    }
  });
});
