import { describe, it, expect } from "vitest";
import { cambiosCustomVisibles, esClaveInterna, etiquetaCustom, valorCustom } from "./custom";

// #933 — «Campos personalizados se actualizó de [object Object] a [object Object]».

describe("cambiosCustomVisibles", () => {
  it("solo la clasificación del bot cambió → no hay renglón (era ~85% de los cambios de custom)", () => {
    const antes = { bot_classification: { type: null, attempts: 1 } };
    const despues = { bot_classification: { type: "BROKER_EXTERNO", attempts: 2, at: "2026-10-26" } };
    expect(cambiosCustomVisibles(antes, despues)).toEqual([]);
  });

  it("lo técnico tampoco aparece (foto, rastro de Meta y Zoho, unidad del Hub)", () => {
    const despues = {
      avatarUrl: "https://cdn/x.jpg",
      perfilMetaLeadId: "123",
      perfilMetaVia: "telefono",
      perfilMetaAt: "2026-10-26",
      zoho: { id: "1" },
      meta_referral: { ad_id: "9" },
      hubUnitId: "u1",
      _interno: 1,
    };
    expect(cambiosCustomVisibles({}, despues)).toEqual([]);
  });

  it("un dato de negocio sale legible, con su etiqueta y su valor", () => {
    expect(cambiosCustomVisibles({}, { inmobiliaria: "Independiente" })).toEqual([
      { clave: "inmobiliaria", etiqueta: "Inmobiliaria", antes: "—", despues: "Independiente" },
    ]);
  });

  it("varios datos en un mismo cambio → un renglón por dato; lo interno de ese cambio se omite", () => {
    const antes = { bot_classification: { attempts: 1 } };
    const despues = {
      bot_classification: { attempts: 2 },
      broker_aporta: "CLIENTE",
      broker_esquema: "COMISION_COMPARTIDA",
      inmobiliaria: "Casa Tulum",
    };
    const c = cambiosCustomVisibles(antes, despues);
    expect(c.map((x) => `${x.etiqueta}: ${x.antes} → ${x.despues}`)).toEqual([
      "Qué aporta el broker: — → Trae un cliente",
      "Esquema de colaboración: — → Comisión compartida",
      "Inmobiliaria: — → Casa Tulum",
    ]);
  });

  it("lo que no cambió no se repite; lo que se borra sale como «—»", () => {
    const antes = { inmobiliaria: "A", ig_username: "ana.g" };
    const despues = { inmobiliaria: "A" };
    expect(cambiosCustomVisibles(antes, despues)).toEqual([
      { clave: "ig_username", etiqueta: "Usuario de Instagram", antes: "ana.g", despues: "—" },
    ]);
  });

  it("valores que no son objeto (null, texto) no truenan", () => {
    expect(cambiosCustomVisibles(null, { presupuesto: 2000000 })).toEqual([
      { clave: "presupuesto", etiqueta: "Presupuesto", antes: "—", despues: "2000000" },
    ]);
    expect(cambiosCustomVisibles("x", undefined)).toEqual([]);
  });

  it("nunca produce «[object Object]»", () => {
    const c = cambiosCustomVisibles({}, { algo_nuevo: { a: 1, b: [1, 2] }, lista: ["x", "y"] });
    for (const x of c) expect(`${x.antes} ${x.despues}`).not.toContain("[object Object]");
    expect(c.find((x) => x.clave === "lista")?.despues).toBe("x, y");
  });
});

describe("piezas", () => {
  it("una clave nueva del bot se muestra con nombre legible (lista de exclusión, no de inclusión)", () => {
    expect(esClaveInterna("zona_interes")).toBe(false);
    expect(etiquetaCustom("zona_interes")).toBe("Zona interes");
    expect(etiquetaCustom("budgetCurrency")).toBe("Budget currency");
  });

  it("valores: sí/no, vacío y texto largo recortado", () => {
    expect(valorCustom("x", true)).toBe("Sí");
    expect(valorCustom("x", false)).toBe("No");
    expect(valorCustom("x", "")).toBe("—");
    expect(valorCustom("x", "a".repeat(200))).toHaveLength(81);
  });
});
