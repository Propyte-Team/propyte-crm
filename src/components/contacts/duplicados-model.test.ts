import { describe, it, expect } from "vitest";
import { resumenFusion, descripcionFusion } from "./duplicados-model";

describe("resumenFusion", () => {
  it("todo fusionado", () => {
    expect(resumenFusion({ fusionados: 2, total: 2 })).toMatchObject({ tono: "ok" });
  });
  it("ninguno fusionado → error con el motivo", () => {
    expect(resumenFusion({ fusionados: 0, total: 2, error: "ya fusionado" })).toEqual({
      tono: "error",
      titulo: "No se pudo fusionar el grupo",
      detalle: "ya fusionado",
    });
  });
  it("parcial avisa cuántos quedaron", () => {
    const r = resumenFusion({ fusionados: 1, total: 3, error: "falló" });
    expect(r.tono).toBe("parcial");
    expect(r.titulo).toContain("1 de 3");
    expect(r.detalle).toContain("2 contactos sin fusionar");
    expect(r.detalle).toContain("falló");
  });
});

describe("descripcionFusion", () => {
  const c = (deals: number, activities: number) => ({ firstName: "Ana", lastName: "Pérez", _count: { deals, activities } });
  it("resume lo que se mueve y se archiva", () => {
    const t = descripcionFusion(c(1, 1), [c(2, 5), c(1, 0)]);
    expect(t).toContain("Se conservará a Ana Pérez");
    expect(t).toContain("3 negocios y 5 actividades");
    expect(t).toContain("Los otros 2 contactos se archivan");
  });
  it("sin nada que mover", () => {
    expect(descripcionFusion(c(0, 0), [c(0, 0)])).toContain("No hay negocios ni actividades que mover");
  });
});
