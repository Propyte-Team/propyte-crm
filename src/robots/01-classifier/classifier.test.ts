import { describe, it, expect } from "vitest";
import { normalizeDevName, NO_DEV_KEY } from "./classifier";

/**
 * Contrato de la clave de dedup (bug #4): el robot persiste
 * `ext_dedup_key = normalizeDevName(nombre)` y deduplica desarrollos con
 * ON CONFLICT (ext_dedup_key). Para que el upsert sea idempotente entre
 * corridas, esta normalización DEBE ser insensible a acento, mayúsculas,
 * puntuación y espacios. Si alguien la rompe, vuelven los duplicados.
 */
describe("normalizeDevName — contrato de la clave de dedup", () => {
  it("es insensible a acentos (la causa real del bug #4: Cancún vs Cancun)", () => {
    expect(normalizeDevName("Dhamar Costa Mujeres Cancún")).toBe(
      normalizeDevName("Dhamar Costa Mujeres Cancun"),
    );
  });

  it("es insensible a mayúsculas", () => {
    expect(normalizeDevName("LOSANTOS CANCUN")).toBe(
      normalizeDevName("losantos cancun"),
    );
  });

  it("colapsa puntuación y espacios", () => {
    expect(normalizeDevName("  Torre   Niktë!! ")).toBe(
      normalizeDevName("Torre Nikte"),
    );
  });

  it("produce una clave estable y no vacía para un nombre normal", () => {
    expect(normalizeDevName("Dhamar Costa Mujeres Cancún")).toBe(
      "dhamar costa mujeres cancun",
    );
  });

  it("nombre vacío/nulo/espacios → NO_DEV_KEY (consistente)", () => {
    expect(normalizeDevName(null)).toBe(NO_DEV_KEY);
    expect(normalizeDevName(undefined)).toBe(NO_DEV_KEY);
    expect(normalizeDevName("   ")).toBe(NO_DEV_KEY);
  });
});
