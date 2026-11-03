import { describe, it, expect } from "vitest";
import { MODELO_DEFAULT, resolverModelo, resolverResponsables, CLAVE_MODELO } from "./modelo";

describe("modelo de reclutamiento", () => {
  it("el default suma 100 puntos: puntuables + actitud + CV", () => {
    const puntuables = Object.values(MODELO_DEFAULT.puntuables).reduce(
      (acc, p) => acc + Math.max(...Object.values(p.puntos)),
      0,
    );
    expect(puntuables).toBe(75);
    expect(puntuables + MODELO_DEFAULT.actitudMax + MODELO_DEFAULT.cvPuntos).toBe(100);
  });

  it("el default tiene los 6 filtros eliminatorios del spec", () => {
    expect(Object.keys(MODELO_DEFAULT.filtros).sort()).toEqual(
      ["acepta_comision", "colchon_meses", "disponibilidad", "mayor_edad", "movilidad", "plaza"].sort(),
    );
  });

  it("colchon_meses: tener otro ingreso pasa el filtro (prueba 2026-11-03: «Tengo otro trabajo»)", () => {
    expect(MODELO_DEFAULT.filtros.colchon_meses.pasa).toContain("OTRO_INGRESO");
  });

  it("la ficha default habla del Gerente de Ventas, no del «gerente de la plaza»", async () => {
    const { FICHA_DEFAULT } = await import("./modelo");
    expect(FICHA_DEFAULT).toContain("Gerente de Ventas");
    expect(FICHA_DEFAULT).not.toMatch(/gerente de la plaza/i);
  });

  it("sin valor en SystemConfig usa el default sin error", () => {
    expect(resolverModelo(undefined)).toEqual({ modelo: MODELO_DEFAULT });
  });

  it("un modelo inválido cae al default y reporta el error", () => {
    const r = resolverModelo({ umbrales: { apto: "alto" } });
    expect(r.modelo).toEqual(MODELO_DEFAULT);
    expect(r.error).toBeTruthy();
  });

  it("un modelo válido con umbrales distintos se respeta", () => {
    const r = resolverModelo({ ...MODELO_DEFAULT, umbrales: { apto: 70, revisar: 50 } });
    expect(r.error).toBeUndefined();
    expect(r.modelo.umbrales).toEqual({ apto: 70, revisar: 50 });
  });

  it("un modelo parcial (falta un filtro) cae al default con error", () => {
    const { plaza: _plaza, ...filtros } = MODELO_DEFAULT.filtros;
    const r = resolverModelo({ ...MODELO_DEFAULT, filtros });
    expect(r.modelo).toEqual(MODELO_DEFAULT);
    expect(r.error).toMatch(/plaza/);
  });

  it("una clave desconocida cae al default con error", () => {
    const r = resolverModelo({ ...MODELO_DEFAULT, extra: 1 });
    expect(r.modelo).toEqual(MODELO_DEFAULT);
    expect(r.error).toBeTruthy();
  });

  it("umbrales cruzados (revisar >= apto) caen al default con error", () => {
    const r = resolverModelo({ ...MODELO_DEFAULT, umbrales: { apto: 40, revisar: 65 } });
    expect(r.modelo).toEqual(MODELO_DEFAULT);
    expect(r.error).toMatch(/revisar/);
  });

  it("un filtro con el mismo valor en pasa y ambiguo cae al default con error", () => {
    const filtros = { ...MODELO_DEFAULT.filtros, movilidad: { activo: true, pasa: ["SI"], ambiguo: ["SI"] } };
    const r = resolverModelo({ ...MODELO_DEFAULT, filtros });
    expect(r.modelo).toEqual(MODELO_DEFAULT);
    expect(r.error).toMatch(/movilidad/);
  });

  it("responsables inválidos o ausentes dan {}", () => {
    expect(resolverResponsables(undefined)).toEqual({});
    expect(resolverResponsables({ PDC: "abc" })).toEqual({});
    expect(resolverResponsables(["u1"])).toEqual({});
    expect(resolverResponsables({ PDC: ["u1"], default: ["u2"] })).toEqual({ PDC: ["u1"], default: ["u2"] });
  });

  it("la clave de SystemConfig es estable", () => {
    expect(CLAVE_MODELO).toBe("reclutamiento.modelo");
  });
});
