import { describe, it, expect } from "vitest";
import {
  campoDeFila, operadoresDeFila, filaNecesitaAvanzado, tipoDeInput, opcionesDeValor,
  valorParaInput, valorDeInput, cambiarCampo, cambiarOperador, buildConditionsTreeGuiado,
  camposAgrupados,
} from "./condition-tree-model";
import { campoPorKey, GRUPOS_DE_CAMPO } from "@/lib/workflows/condition-catalog";
import type { ConditionTree } from "@/lib/workflows/builder-model";

const fuente = campoPorKey("contact.leadSource")!;
const score = campoPorKey("contact.score")!;
const noContactar = campoPorKey("contact.doNotContact")!;
const zona = campoPorKey("contact.preferredZone")!;

describe("tipoDeInput", () => {
  it("elige el input según tipo y operador", () => {
    expect(tipoDeInput(fuente, "eq")).toBe("select");
    expect(tipoDeInput(fuente, "changed_to")).toBe("select");
    expect(tipoDeInput(fuente, "in")).toBe("multiselect");
    expect(tipoDeInput(fuente, "nin")).toBe("multiselect");
    expect(tipoDeInput(fuente, "exists")).toBe("none");
    expect(tipoDeInput(score, "gte")).toBe("number");
    expect(tipoDeInput(zona, "contains")).toBe("text");
    expect(tipoDeInput(noContactar, "eq")).toBe("boolean");
    expect(tipoDeInput(null, "eq")).toBe("text");
  });
});

describe("fila", () => {
  it("campo y operadores del catálogo", () => {
    expect(campoDeFila({ field: "contact.score", op: "gt", value: "" })?.key).toBe("contact.score");
    expect(operadoresDeFila({ field: "contact.score", op: "gt", value: "" }).map((o) => o.value)).toContain("gte");
    expect(operadoresDeFila({ field: "contact.custom.x", op: "eq", value: "" })).toEqual([]);
  });
  it("detecta cuándo necesita Avanzado", () => {
    expect(filaNecesitaAvanzado({ field: "", op: "eq", value: "" })).toBe(false);
    expect(filaNecesitaAvanzado({ field: "contact.leadSource", op: "eq", value: "META_ADS" })).toBe(false);
    expect(filaNecesitaAvanzado({ field: "contact.custom.x", op: "eq", value: "1" })).toBe(true);
    expect(filaNecesitaAvanzado({ field: "contact.leadSource", op: "gt", value: "1" })).toBe(true);
    expect(filaNecesitaAvanzado({ field: "deal.stage", op: "eq", value: "WON" }, "contact")).toBe(true);
    expect(filaNecesitaAvanzado({ field: "deal.stage", op: "eq", value: "WON" }, "deal")).toBe(false);
  });
  it("conserva valores de enum fuera del diccionario", () => {
    const o = opcionesDeValor(fuente, ["VIEJO_X"]);
    expect(o.some((x) => x.value === "VIEJO_X")).toBe(true);
    expect(o.length).toBeGreaterThan(1);
  });
});

describe("conversión de valor", () => {
  it("in/nin ⇄ lista", () => {
    const leaf = { field: "contact.leadSource", op: "in", value: "META_ADS, GOOGLE_ADS" };
    expect(valorParaInput(leaf)).toEqual(["META_ADS", "GOOGLE_ADS"]);
    expect(valorDeInput(fuente, "in", ["A", "B"])).toBe("A,B");
  });
  it("booleano ⇄ true/false", () => {
    expect(valorParaInput({ field: "contact.doNotContact", op: "eq", value: "true" })).toBe(true);
    expect(valorParaInput({ field: "contact.doNotContact", op: "eq", value: "false" })).toBe(false);
    expect(valorDeInput(noContactar, "eq", true)).toBe("true");
    expect(valorDeInput(noContactar, "eq", false)).toBe("false");
  });
  it("cambiarCampo y cambiarOperador", () => {
    expect(cambiarCampo({ field: "", op: "eq", value: "x" }, "contact.doNotContact")).toEqual({ field: "contact.doNotContact", op: "eq", value: "true" });
    expect(cambiarCampo({ field: "contact.score", op: "gte", value: "5" }, "contact.leadSource")).toEqual({ field: "contact.leadSource", op: "eq", value: "" });
    expect(cambiarCampo({ field: "contact.score", op: "gte", value: "5" }, "contact.budgetMax").op).toBe("gte");
    expect(cambiarOperador({ field: "contact.leadSource", op: "in", value: "A,B" }, "eq").value).toBe("A");
    expect(cambiarOperador({ field: "contact.leadSource", op: "eq", value: "A" }, "in").value).toBe("A");
    expect(cambiarOperador({ field: "contact.leadSource", op: "eq", value: "A" }, "exists").value).toBe("");
  });
});

describe("buildConditionsTreeGuiado", () => {
  const tree = (items: ConditionTree["items"]): ConditionTree => ({ combinator: "all", items });
  it("booleano guiado → true real", () => {
    expect(buildConditionsTreeGuiado(tree([{ field: "contact.doNotContact", op: "eq", value: "true" }])))
      .toEqual({ all: [{ field: "contact.doNotContact", op: "eq", value: true }] });
    expect(buildConditionsTreeGuiado(tree([{ field: "contact.doNotContact", op: "eq", value: "false" }])))
      .toEqual({ all: [{ field: "contact.doNotContact", op: "eq", value: false }] });
  });
  it("número → number; in → array; exists → true", () => {
    expect(buildConditionsTreeGuiado(tree([
      { field: "contact.score", op: "gte", value: "70" },
      { field: "contact.leadSource", op: "in", value: "META_ADS,GOOGLE_ADS" },
      { field: "contact.leadSource", op: "exists", value: "" },
    ]))).toEqual({ all: [
      { field: "contact.score", op: "gte", value: 70 },
      { field: "contact.leadSource", op: "in", value: ["META_ADS", "GOOGLE_ADS"] },
      { field: "contact.leadSource", op: "exists", value: true },
    ] });
  });
  it("campo desconocido igual que antes; subgrupos; descarta filas vacías", () => {
    expect(buildConditionsTreeGuiado({ combinator: "any", items: [
      { field: "contact.custom.edad", op: "gt", value: "30" },
      { field: "", op: "eq", value: "x" },
      { combinator: "all", conditions: [
        { field: "contact.custom.tag", op: "in", value: "a, b" },
        { field: "contact.doNotContact", op: "eq", value: "true" },
      ] },
    ] })).toEqual({ any: [
      { field: "contact.custom.edad", op: "gt", value: 30 },
      { all: [
        { field: "contact.custom.tag", op: "in", value: ["a", "b"] },
        { field: "contact.doNotContact", op: "eq", value: true },
      ] },
    ] });
    expect(buildConditionsTreeGuiado(tree([]))).toEqual({});
  });
});

describe("camposAgrupados", () => {
  it("respeta el contexto y el orden de grupos", () => {
    expect(camposAgrupados("contact", GRUPOS_DE_CAMPO).map((x) => x.grupo)).not.toContain("Negocio");
    expect(camposAgrupados("event", GRUPOS_DE_CAMPO).map((x) => x.grupo)).toContain("Evento");
  });
});
