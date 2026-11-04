import { describe, expect, it } from "vitest";
import { construirMatrizReglas } from "./matriz-reglas";

const r = (id: string, dealType: string, leadSourceCategory: string, role: string, percentage = 1) => ({
  id,
  dealType,
  leadSourceCategory,
  role,
  percentage,
  isActive: true,
});

describe("construirMatrizReglas", () => {
  it("sin reglas: matriz vacía", () => {
    expect(construirMatrizReglas([])).toEqual({ columnas: [], filas: [] });
  });

  it("una fila por origen+rol y una columna por tipo de operación, con celdas vacías", () => {
    const reglas = [
      r("1", "NATIVA_CONTADO", "PROPYTE_LEAD", "ASESOR_SR"),
      r("2", "MACROLOTE", "PROPYTE_LEAD", "ASESOR_SR"),
      r("3", "MACROLOTE", "BROKER_LEAD", "GERENTE"),
    ];
    const m = construirMatrizReglas(reglas, { dealTypes: ["NATIVA_CONTADO", "MACROLOTE"] });
    expect(m.columnas).toEqual(["NATIVA_CONTADO", "MACROLOTE"]);
    expect(m.filas).toHaveLength(2);
    const propyte = m.filas.find((f) => f.leadSourceCategory === "PROPYTE_LEAD")!;
    expect(propyte.celdas.map((c) => c?.id ?? null)).toEqual(["1", "2"]);
    const broker = m.filas.find((f) => f.leadSourceCategory === "BROKER_LEAD")!;
    expect(broker.celdas.map((c) => c?.id ?? null)).toEqual([null, "3"]);
  });

  it("ordena filas por origen y rol según el orden dado; lo desconocido al final", () => {
    const reglas = [
      r("1", "A", "ZETA", "GERENTE"),
      r("2", "A", "PROPYTE_LEAD", "ASESOR_JR"),
      r("3", "A", "PROPYTE_LEAD", "ASESOR_SR"),
    ];
    const m = construirMatrizReglas(reglas, {
      origenes: ["PROPYTE_LEAD"],
      roles: ["ASESOR_SR", "ASESOR_JR"],
    });
    expect(m.filas.map((f) => `${f.leadSourceCategory}|${f.role}`)).toEqual([
      "PROPYTE_LEAD|ASESOR_SR",
      "PROPYTE_LEAD|ASESOR_JR",
      "ZETA|GERENTE",
    ]);
  });

  it("si hay dos reglas en la misma celda, gana la primera", () => {
    const m = construirMatrizReglas([r("1", "A", "X", "Y", 1), r("2", "A", "X", "Y", 2)]);
    expect(m.filas).toHaveLength(1);
    expect(m.filas[0].celdas[0]?.id).toBe("1");
  });
});
