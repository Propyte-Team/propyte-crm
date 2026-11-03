import { describe, it, expect } from "vitest";
import { MODELO_DEFAULT, resolverModelo, CLAVE_MODELO } from "./modelo";

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

  it("la clave de SystemConfig es estable", () => {
    expect(CLAVE_MODELO).toBe("reclutamiento.modelo");
  });
});
