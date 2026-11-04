import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAMPOS_DE_CONDICION, GRUPOS_DE_CAMPO, EVENTOS_DE_CONDICION, camposPara, campoPorKey, operadoresPara,
  valorParaGuardar, valorDesdeDsl, describeConditions, validarCondiciones, FIELD_LABELS, FIELD_VALUE_LABELS,
} from "./condition-catalog";
import { evaluateConditions } from "./evaluate-conditions";
import type { ConditionNode } from "@/lib/validations/rebuild-f1";

const raiz = process.cwd();
const schema = readFileSync(join(raiz, "prisma/schema.prisma"), "utf8");

function valoresDeEnum(nombre: string): string[] {
  const m = schema.match(new RegExp(`^enum ${nombre} \\{([\\s\\S]*?)^\\}`, "m"));
  if (!m) throw new Error(`enum ${nombre} no encontrado`);
  return m[1].split("\n").map((l) => l.replace(/\/\/.*/, "").trim()).filter((l) => /^\w+$/.test(l));
}

// campo del catálogo → enum de Prisma que lo respalda
const ENUM_DE_CAMPO: Record<string, string> = {
  "contact.leadSource": "LeadSource", "contact.contactType": "ContactType", "contact.targetPlaza": "Plaza",
  "contact.preferredLanguage": "PreferredLanguage", "contact.propertyType": "PropertyType",
  "contact.purchaseTimeline": "PurchaseTimeline", "contact.paymentMethod": "PaymentMethod",
  "contact.investmentProfile": "InvestmentProfile", "contact.purchaseModality": "PurchaseModality",
  "contact.rentalStrategy": "RentalStrategy", "contact.temperature": "LeadTemperature",
  "contact.contactStatus": "ContactStatus", "contact.lifecycleStage": "LifecycleStage",
  "contact.urgency": "Urgency", "deal.stage": "DealStage", "deal.dealType": "DealType",
  "deal.currency": "Currency", "deal.lostReason": "LostReason",
};

describe("catálogo: enums contra el schema de Prisma", () => {
  it("cada campo enum (salvo event.type) está mapeado a un enum", () => {
    const sinMapa = CAMPOS_DE_CONDICION.filter((c) => c.tipo === "enum" && c.key !== "event.type" && !ENUM_DE_CAMPO[c.key]);
    expect(sinMapa.map((c) => c.key)).toEqual([]);
  });
  for (const [key, enumName] of Object.entries(ENUM_DE_CAMPO)) {
    it(`${key} tiene etiqueta para cada valor de ${enumName}`, () => {
      const campo = campoPorKey(key)!;
      expect(campo.opciones).toBeDefined();
      const faltan = valoresDeEnum(enumName).filter((v) => !campo.opciones![v]);
      expect(faltan).toEqual([]);
    });
  }
  it("event.type etiqueta todos los eventos de DomainEventType", () => {
    const src = readFileSync(join(raiz, "src/lib/workflows/events.ts"), "utf8");
    const tipos = [...src.matchAll(/^\s*\| "([\w.]+)"/gm)].map((m) => m[1]);
    expect(tipos.length).toBeGreaterThan(10);
    expect(tipos.filter((t) => !EVENTOS_DE_CONDICION[t])).toEqual([]);
  });
  it("los campos existen en el schema (Contact, Deal, AdAttribution)", () => {
    const cuerpo = (modelo: string) => schema.match(new RegExp(`^model ${modelo} \\{([\\s\\S]*?)^\\}`, "m"))![1];
    const modelos: Record<string, string> = { contact: cuerpo("Contact"), deal: cuerpo("Deal"), adAttribution: cuerpo("AdAttribution") };
    for (const c of CAMPOS_DE_CONDICION) {
      const [raizKey, campo] = c.key.split(".");
      // event.* y context.* no son columnas: los arma buildContext (engine.ts) al evaluar.
      if (raizKey === "event" || raizKey === "context") continue;
      // deal.hasQuote lo calcula loadEntityContext (existe una Quote del negocio), no es columna.
      if (c.key === "deal.hasQuote") continue;
      expect(modelos[raizKey], c.key).toMatch(new RegExp(`^\\s+${campo}\\s`, "m"));
    }
  });
  it("grupos y claves únicas", () => {
    expect(new Set(CAMPOS_DE_CONDICION.map((c) => c.key)).size).toBe(CAMPOS_DE_CONDICION.length);
    for (const c of CAMPOS_DE_CONDICION) expect(GRUPOS_DE_CAMPO).toContain(c.grupo);
  });
});

describe("camposPara / operadoresPara", () => {
  it("event.type solo en contexto event; deal.* no en contact", () => {
    expect(camposPara("contact").some((c) => c.key.startsWith("deal.") || c.key === "event.type")).toBe(false);
    expect(camposPara("deal").some((c) => c.key === "deal.stage")).toBe(true);
    expect(camposPara("event").some((c) => c.key === "event.type")).toBe(true);
  });
  it("operadores por tipo con etiquetas en español", () => {
    expect(operadoresPara("enum").map((o) => o.value)).toEqual(["eq", "neq", "in", "nin", "exists", "changed_to"]);
    expect(operadoresPara("number").find((o) => o.value === "gte")?.label).toBe("al menos");
    expect(operadoresPara("text").map((o) => o.value)).toEqual(["eq", "neq", "contains", "exists"]);
    expect(operadoresPara("boolean").map((o) => o.value)).toEqual(["eq"]);
  });
});

describe("valorParaGuardar / valorDesdeDsl", () => {
  const enumCampo = campoPorKey("contact.leadSource")!;
  const num = campoPorKey("contact.budgetMax")!;
  const bool = campoPorKey("contact.doNotContact")!;
  const texto = campoPorKey("contact.preferredZone")!;
  it("forma guardada correcta por tipo/operador", () => {
    expect(valorParaGuardar(enumCampo, "in", ["META_ADS", "INSTAGRAM"])).toEqual(["META_ADS", "INSTAGRAM"]);
    expect(valorParaGuardar(enumCampo, "in", "A, B")).toEqual(["A", "B"]);
    expect(valorParaGuardar(enumCampo, "eq", "META_ADS")).toBe("META_ADS");
    expect(valorParaGuardar(num, "gte", "250000")).toBe(250000);
    expect(valorParaGuardar(num, "gte", "abc")).toBe("abc");
    expect(valorParaGuardar(bool, "eq", "true")).toBe(true);
    expect(valorParaGuardar(bool, "eq", false)).toBe(false);
    expect(valorParaGuardar(texto, "eq", "123")).toBe("123");
    expect(valorParaGuardar(texto, "exists", "")).toBe(true);
    expect(valorParaGuardar(undefined, "gt", "5")).toBe(5);
  });
  it("son inversas", () => {
    const casos: Array<[typeof enumCampo, string, string | string[] | boolean]> = [
      [enumCampo, "in", ["META_ADS", "INSTAGRAM"]], [enumCampo, "eq", "META_ADS"], [num, "gte", "250000"],
      [bool, "eq", true], [bool, "eq", false], [texto, "contains", "Tulum"],
    ];
    for (const [c, op, edit] of casos) {
      expect(valorDesdeDsl(c, op, valorParaGuardar(c, op, edit))).toEqual(edit);
    }
  });
  it("lo guardado se evalúa como se espera (number para gte, array para in)", () => {
    const dsl = { all: [
      { field: "contact.budgetMax", op: "gte", value: valorParaGuardar(num, "gte", "250000") },
      { field: "contact.leadSource", op: "in", value: valorParaGuardar(enumCampo, "in", ["META_ADS"]) },
      { field: "contact.doNotContact", op: "eq", value: valorParaGuardar(bool, "eq", "false") },
    ] } as ConditionNode;
    expect(evaluateConditions(dsl, { contact: { budgetMax: 300000, leadSource: "META_ADS", doNotContact: false } })).toBe(true);
  });
});

describe("describeConditions", () => {
  it("sin condiciones → siempre (o texto propio)", () => {
    expect(describeConditions({})).toBe("siempre");
    expect(describeConditions(null)).toBe("siempre");
    expect(describeConditions({ all: [{ any: [] }] })).toBe("siempre");
    expect(describeConditions({}, { vacio: "sin condiciones" })).toBe("sin condiciones");
  });
  it("frases con etiquetas y miles", () => {
    expect(describeConditions({ all: [
      { field: "contact.leadSource", op: "eq", value: "META_ADS" },
      { field: "contact.budgetMax", op: "gte", value: 250000 },
    ] })).toBe("fuente es Meta Ads y presupuesto máx. es al menos 250,000");
  });
  it("any anidado, listas, exists, boolean, evento, campo desconocido", () => {
    expect(describeConditions({ any: [
      { field: "contact.targetPlaza", op: "eq", value: "TULUM" },
      { field: "contact.preferredLanguage", op: "eq", value: "EN" },
    ] })).toBe("(plaza es Tulum o idioma es Inglés)");
    expect(describeConditions({ field: "contact.leadSource", op: "in", value: ["META_ADS", "INSTAGRAM"] })).toBe("fuente es alguno de Meta Ads, Instagram");
    expect(describeConditions({ field: "contact.leadSource", op: "nin", value: ["OTRO"] })).toBe("fuente no es ninguno de Otro");
    expect(describeConditions({ field: "contact.preferredZone", op: "exists", value: true })).toBe("zona preferida tiene valor");
    expect(describeConditions({ field: "contact.doNotContact", op: "eq", value: true })).toBe("no contactar es Sí");
    expect(describeConditions({ field: "event.type", op: "eq", value: "deal.won" })).toBe("evento es Negocio ganado");
    expect(describeConditions({ field: "deal.stage", op: "changed_to", value: "WON" })).toBe("etapa del negocio cambió a Ganado");
    expect(describeConditions({ field: "contact.custom.idioma", op: "eq", value: "pt" })).toBe("custom.idioma es pt");
    expect(describeConditions({ field: "contact.custom.edad", op: "gt", value: 1500 })).toBe("custom.edad es mayor que 1,500");
  });
  it("FIELD_LABELS y FIELD_VALUE_LABELS salen del catálogo", () => {
    expect(FIELD_LABELS["contact.budgetMax"]).toBe("presupuesto máx.");
    expect(FIELD_VALUE_LABELS["contact.leadSource"].META_ADS).toBe("Meta Ads");
    expect(FIELD_VALUE_LABELS["contact.score"]).toBeUndefined();
  });
});

describe("validarCondiciones", () => {
  const hoja = (field: string, op: string, value?: unknown) => ({ field, op, value });
  it("árbol vacío y condiciones correctas → ok", () => {
    expect(validarCondiciones({})).toEqual({ ok: true, problemas: [] });
    expect(validarCondiciones({ all: [hoja("contact.leadSource", "in", ["META_ADS"]), hoja("contact.score", "gt", 5), hoja("contact.preferredZone", "exists", true)] }).ok).toBe(true);
    expect(validarCondiciones({ all: [hoja("contact.doNotContact", "eq", "false")] }).ok).toBe(true);
  });
  it("detecta incompletas", () => {
    const malos: unknown[] = [
      hoja("", "eq", "x"),
      hoja("contact.score", "", 1),
      hoja("contact.leadSource", "eq", ""),
      hoja("contact.leadSource", "in", []),
      hoja("contact.score", "gt", "abc"),
      hoja("contact.score", "gt", "  "),
      hoja("contact.leadSource", "gt", 5),
      hoja("contact.preferredZone", "in", ["a"]),
      hoja("contact.doNotContact", "eq", "tal vez"),
      hoja("contact.custom.x", "eq", ""),
    ];
    for (const m of malos) {
      const r = validarCondiciones({ all: [m] });
      expect(r.ok, JSON.stringify(m)).toBe(false);
      expect(r.problemas.length).toBeGreaterThan(0);
    }
  });
  it("campo fuera del catálogo solo se valida por vacío; recorre grupos", () => {
    expect(validarCondiciones(hoja("contact.custom.x", "gt", "lo que sea")).ok).toBe(true);
    expect(validarCondiciones({ all: [{ any: [hoja("contact.score", "gt", "")] }] }).ok).toBe(false);
  });
});
