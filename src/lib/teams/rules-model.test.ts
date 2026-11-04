import { describe, it, expect } from "vitest";
import {
  describeConditions, describeTargets, buildTargets, parseTargets, nextPriority,
  strategyOptions, hasIncompleteCondition, STRATEGY_LABELS,
} from "./rules-model";

describe("describeConditions", () => {
  it("sin condiciones → siempre", () => {
    expect(describeConditions({})).toBe("siempre");
    expect(describeConditions(null)).toBe("siempre");
    expect(describeConditions({ all: [] })).toBe("siempre");
  });
  it("hoja con etiqueta legible", () => {
    expect(describeConditions({ field: "contact.leadSource", op: "eq", value: "META_ADS" })).toBe("fuente es Meta Ads");
    expect(describeConditions({ field: "contact.budgetMax", op: "gte", value: 250000 })).toBe("presupuesto máx. es al menos 250,000");
    expect(describeConditions({ field: "contact.preferredZone", op: "exists" })).toBe("zona preferida tiene valor");
  });
  it("all → y; any → o entre paréntesis; listas con coma", () => {
    expect(describeConditions({
      all: [
        { field: "contact.targetPlaza", op: "eq", value: "TULUM" },
        { any: [{ field: "contact.preferredLanguage", op: "eq", value: "EN" }, { field: "contact.score", op: "gt", value: 50 }] },
      ],
    })).toBe("plaza es Tulum y (idioma es Inglés o score es mayor que 50)");
    expect(describeConditions({ field: "contact.leadSource", op: "in", value: ["META_ADS", "INSTAGRAM"] })).toBe("fuente es alguno de Meta Ads, Instagram");
  });
  it("valores con etiqueta según el campo; sin diccionario se dejan tal cual", () => {
    expect(describeConditions({ field: "contact.contactType", op: "eq", value: "LEAD_COMPRADOR" })).toBe("tipo de contacto es Lead Comprador");
    expect(describeConditions({ field: "contact.temperature", op: "eq", value: "HOT" })).toBe("temperatura es Caliente");
    expect(describeConditions({ field: "adAttribution.campaignName", op: "contains", value: "META_ADS" })).toBe("campaña contiene META_ADS");
    expect(describeConditions({ field: "contact.targetPlaza", op: "in", value: ["PDC", "MERIDA"] })).toBe("plaza es alguno de Playa del Carmen, Mérida");
  });
  it("campo desconocido se muestra sin el prefijo contact.", () => {
    expect(describeConditions({ field: "contact.custom.idioma", op: "eq", value: "pt" })).toBe("custom.idioma es pt");
  });
});

describe("describeTargets", () => {
  it("usuarios por nombre, con fallback al id corto", () => {
    expect(describeTargets({ userIds: ["aaaaaaaa-1", "bbbbbbbb-2"] }, { "aaaaaaaa-1": "Ana" })).toBe("Usuarios: Ana, bbbbbbbb");
  });
  it("roles con o sin plaza", () => {
    expect(describeTargets({ roles: ["ASESOR_SR"], plaza: "PDC" })).toBe("Asesor Senior de Playa del Carmen");
    expect(describeTargets({ roles: ["ASESOR", "TEAM_LEADER"] })).toBe("Asesor, Líder de equipo de la plaza del lead");
    expect(describeTargets({})).toBe("asesores de la plaza del lead");
    expect(describeTargets(undefined)).toBe("asesores de la plaza del lead");
  });
});

describe("buildTargets / parseTargets", () => {
  it("modo roles omite claves vacías", () => {
    expect(buildTargets({ mode: "roles", roles: [], userIds: ["x"], plaza: "" })).toEqual({});
    expect(buildTargets({ mode: "roles", roles: ["ASESOR"], userIds: [], plaza: "TULUM" })).toEqual({ roles: ["ASESOR"], plaza: "TULUM" });
  });
  it("modo usuarios ignora roles y plaza", () => {
    expect(buildTargets({ mode: "users", roles: ["ASESOR"], userIds: ["u1"], plaza: "PDC" })).toEqual({ userIds: ["u1"] });
    expect(buildTargets({ mode: "users", roles: [], userIds: [], plaza: "" })).toEqual({});
  });
  it("parse es inverso de build", () => {
    expect(parseTargets({ userIds: ["u1"] })).toEqual({ mode: "users", roles: [], userIds: ["u1"], plaza: "", teamId: "" });
    expect(parseTargets({ roles: ["ASESOR"], plaza: "PDC" })).toEqual({ mode: "roles", roles: ["ASESOR"], userIds: [], plaza: "PDC", teamId: "" });
    expect(parseTargets(null)).toEqual({ mode: "roles", roles: [], userIds: [], plaza: "", teamId: "" });
  });
});

describe("destino por equipo", () => {
  it("describeTargets muestra el nombre del equipo", () => {
    expect(describeTargets({ teamId: "tttttttt-1" }, {}, { "tttttttt-1": "Tulum Centro" })).toBe("Equipo Tulum Centro");
    expect(describeTargets({ teamId: "tttttttt-1" })).toBe("Equipo tttttttt");
  });
  it("buildTargets en modo team ignora roles, usuarios y plaza", () => {
    expect(buildTargets({ mode: "team", roles: ["ASESOR"], userIds: ["u1"], plaza: "PDC", teamId: "t1" })).toEqual({ teamId: "t1" });
    expect(buildTargets({ mode: "team", roles: [], userIds: [], plaza: "", teamId: "" })).toEqual({});
  });
  it("parseTargets reconoce teamId", () => {
    expect(parseTargets({ teamId: "t1" })).toEqual({ mode: "team", roles: [], userIds: [], plaza: "", teamId: "t1" });
  });
});

describe("nextPriority", () => {
  it("100 sin reglas; última + 10 con tope 1000", () => {
    expect(nextPriority([])).toBe(100);
    expect(nextPriority([{ priority: 100 }, { priority: 230 }])).toBe(240);
    expect(nextPriority([{ priority: 995 }])).toBe(1000);
  });
});

describe("strategyOptions", () => {
  it("ofrece solo Turno y Menor carga", () => {
    expect(strategyOptions().map((o) => o.label)).toEqual(["Turno", "Menor carga"]);
  });
  it("conserva una estrategia retirada si la regla ya la tiene", () => {
    expect(strategyOptions("GUARDIA")).toEqual([
      { value: "ROUND_ROBIN", label: "Turno" },
      { value: "PERFORMANCE", label: "Menor carga" },
      { value: "GUARDIA", label: "Guardia" },
    ]);
    expect(STRATEGY_LABELS.MANUAL).toBe("Manual");
  });
});

describe("hasIncompleteCondition", () => {
  const leaf = (field: string, op: string, value: string) => ({ field, op, value });
  it("árbol vacío o completo → false", () => {
    expect(hasIncompleteCondition({ combinator: "all", items: [] })).toBe(false);
    expect(hasIncompleteCondition({ combinator: "all", items: [leaf("contact.leadSource", "eq", "META_ADS"), leaf("contact.score", "exists", "")] })).toBe(false);
  });
  it("campo, operador o valor vacío → true", () => {
    expect(hasIncompleteCondition({ combinator: "all", items: [leaf("", "eq", "x")] })).toBe(true);
    expect(hasIncompleteCondition({ combinator: "all", items: [leaf("contact.score", "", "1")] })).toBe(true);
    expect(hasIncompleteCondition({ combinator: "all", items: [leaf("contact.score", "gt", "  ")] })).toBe(true);
  });
  it("revisa dentro de los grupos", () => {
    expect(hasIncompleteCondition({ combinator: "all", items: [{ combinator: "any", conditions: [leaf("contact.score", "gt", "")] }] })).toBe(true);
    expect(hasIncompleteCondition({ combinator: "all", items: [{ combinator: "any", conditions: [leaf("contact.score", "gt", "5")] }] })).toBe(false);
  });
});
