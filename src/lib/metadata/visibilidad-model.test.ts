import { describe, it, expect } from "vitest";
import { resumenPorRol, textoResumen, camposQueSeOcultan, aplicarAcceso, accesoDe, type PermisoCelda } from "./visibilidad-model";

const P: PermisoCelda[] = [
  { fieldKey: "a", role: "ASESOR", access: "HIDDEN" },
  { fieldKey: "b", role: "ASESOR", access: "HIDDEN" },
  { fieldKey: "c", role: "ASESOR", access: "HIDDEN" },
  { fieldKey: "d", role: "ASESOR", access: "READ" },
  { fieldKey: "e", role: "ASESOR", access: "READ" },
  { fieldKey: "a", role: "BROKER", access: "READ" },
];

describe("resumen por rol", () => {
  it("cuenta ocultos y solo lectura, omite roles sin restricción", () => {
    const r = resumenPorRol(P, ["ASESOR", "BROKER", "GERENTE"]);
    expect(r).toEqual([
      { role: "ASESOR", ocultos: 3, soloLectura: 2 },
      { role: "BROKER", ocultos: 0, soloLectura: 1 },
    ]);
  });
  it("textoResumen", () => {
    expect(textoResumen({ ocultos: 3, soloLectura: 2 })).toBe("3 ocultos, 2 solo lectura");
    expect(textoResumen({ ocultos: 1, soloLectura: 0 })).toBe("1 oculto");
    expect(textoResumen(undefined)).toBe("Sin restricciones");
  });
});

describe("camposQueSeOcultan", () => {
  it("solo cuenta los que hoy no están ocultos", () => {
    expect(camposQueSeOcultan(P, "ASESOR", ["a", "d", "z"], "HIDDEN")).toEqual(["d", "z"]);
  });
  it("otros accesos no requieren confirmar", () => {
    expect(camposQueSeOcultan(P, "ASESOR", ["a"], "READ")).toEqual([]);
  });
});

describe("aplicarAcceso", () => {
  it("EDIT borra la restricción", () => {
    const r = aplicarAcceso(P, "ASESOR", ["a", "b"], "EDIT");
    expect(accesoDe(r, "a", "ASESOR")).toBe("EDIT");
    expect(accesoDe(r, "c", "ASESOR")).toBe("HIDDEN");
  });
  it("HIDDEN reemplaza sin duplicar y no toca otros roles", () => {
    const r = aplicarAcceso(P, "ASESOR", ["d", "z"], "HIDDEN");
    expect(r.filter((p) => p.role === "ASESOR" && p.fieldKey === "d")).toHaveLength(1);
    expect(accesoDe(r, "d", "ASESOR")).toBe("HIDDEN");
    expect(accesoDe(r, "a", "BROKER")).toBe("READ");
  });
});
