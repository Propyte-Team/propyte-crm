import { describe, it, expect } from "vitest";
import { BRAND_READ_ROLES, BRAND_WRITE_ROLES, canReadBrands, canWriteBrands } from "./roles";

describe("permisos de marcas", () => {
  it("MARKETING puede leer pero no escribir", () => {
    expect(canReadBrands("MARKETING")).toBe(true);
    expect(canWriteBrands("MARKETING")).toBe(false);
  });

  it("GERENTE puede leer y escribir", () => {
    expect(canReadBrands("GERENTE")).toBe(true);
    expect(canWriteBrands("GERENTE")).toBe(true);
  });

  it("ADMIN y DIRECTOR pueden las dos cosas", () => {
    for (const role of ["ADMIN", "DIRECTOR"]) {
      expect(canReadBrands(role), `${role} lee`).toBe(true);
      expect(canWriteBrands(role), `${role} escribe`).toBe(true);
    }
  });

  it("ASESOR no puede ninguna de las dos", () => {
    expect(canReadBrands("ASESOR")).toBe(false);
    expect(canWriteBrands("ASESOR")).toBe(false);
  });

  it("null, undefined, vacío o rol desconocido no pueden ninguna (fail-closed)", () => {
    for (const role of [null, undefined, "", "SUPERUSUARIO"]) {
      expect(canReadBrands(role), `lee ${String(role)}`).toBe(false);
      expect(canWriteBrands(role), `escribe ${String(role)}`).toBe(false);
    }
  });

  it("escribir es un subconjunto de leer", () => {
    for (const role of BRAND_WRITE_ROLES) {
      expect((BRAND_READ_ROLES as readonly string[]).includes(role)).toBe(true);
    }
  });
});
