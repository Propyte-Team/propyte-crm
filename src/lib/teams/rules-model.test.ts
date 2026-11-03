import { describe, it, expect } from "vitest";
import { describeConditions, describeTargets, buildTargets, parseTargets, nextPriority } from "./rules-model";

describe("describeConditions", () => {
  it("sin condiciones → siempre", () => {
    expect(describeConditions({})).toBe("siempre");
    expect(describeConditions(null)).toBe("siempre");
    expect(describeConditions({ all: [] })).toBe("siempre");
  });
  it("hoja con etiqueta legible", () => {
    expect(describeConditions({ field: "contact.leadSource", op: "eq", value: "META_ADS" })).toBe("fuente = META_ADS");
    expect(describeConditions({ field: "contact.budgetMax", op: "gte", value: 250000 })).toBe("presupuesto máx. ≥ 250000");
    expect(describeConditions({ field: "contact.preferredZone", op: "exists" })).toBe("zona preferida existe");
  });
  it("all → y; any → o entre paréntesis; listas con coma", () => {
    expect(describeConditions({
      all: [
        { field: "contact.targetPlaza", op: "eq", value: "TULUM" },
        { any: [{ field: "contact.preferredLanguage", op: "eq", value: "EN" }, { field: "contact.score", op: "gt", value: 50 }] },
      ],
    })).toBe("plaza = TULUM y (idioma = EN o score > 50)");
    expect(describeConditions({ field: "contact.leadSource", op: "in", value: ["META_ADS", "INSTAGRAM"] })).toBe("fuente en META_ADS, INSTAGRAM");
  });
  it("campo desconocido se muestra sin el prefijo contact.", () => {
    expect(describeConditions({ field: "contact.custom.idioma", op: "eq", value: "pt" })).toBe("custom.idioma = pt");
  });
});

describe("describeTargets", () => {
  it("usuarios por nombre, con fallback al id corto", () => {
    expect(describeTargets({ userIds: ["aaaaaaaa-1", "bbbbbbbb-2"] }, { "aaaaaaaa-1": "Ana" })).toBe("Usuarios: Ana, bbbbbbbb");
  });
  it("roles con o sin plaza", () => {
    expect(describeTargets({ roles: ["ASESOR_SR"], plaza: "PDC" })).toBe("ASESOR_SR de PDC");
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
    expect(parseTargets({ userIds: ["u1"] })).toEqual({ mode: "users", roles: [], userIds: ["u1"], plaza: "" });
    expect(parseTargets({ roles: ["ASESOR"], plaza: "PDC" })).toEqual({ mode: "roles", roles: ["ASESOR"], userIds: [], plaza: "PDC" });
    expect(parseTargets(null)).toEqual({ mode: "roles", roles: [], userIds: [], plaza: "" });
  });
});

describe("nextPriority", () => {
  it("100 sin reglas; última + 10 con tope 1000", () => {
    expect(nextPriority([])).toBe(100);
    expect(nextPriority([{ priority: 100 }, { priority: 230 }])).toBe(240);
    expect(nextPriority([{ priority: 995 }])).toBe(1000);
  });
});
